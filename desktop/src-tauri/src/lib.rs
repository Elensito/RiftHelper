use serde::Serialize;
use tauri::Emitter;
use tauri::Manager;
use std::sync::Arc;
use std::sync::Mutex;
use std::process::{Command, Child};

use std::io::Write;

use std::os::windows::process::CommandExt;

use windows::core::Interface;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::{
    D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_11_0,
};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ,
    D3D11_MAPPED_SUBRESOURCE, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
    DXGI_OUTDUPL_FRAME_INFO,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};

struct FFmpegProcess {
    child: Child,
    stdin: Option<std::process::ChildStdin>,
}

static FFMPEG_PROC: Mutex<Option<FFmpegProcess>> = Mutex::new(None);
static FFMPEG_OUTPUT: Mutex<Option<String>> = Mutex::new(None);
static AUDIO_CAPTURE_STOP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

struct EventCaptureHandle {
    stop: Arc<std::sync::atomic::AtomicBool>,
}

static EVENT_CAPTURE: Mutex<Option<EventCaptureHandle>> = Mutex::new(None);

/* Raw "gameMode\tgameType" of the most recently recorded game, read from the
   Live Client Data API while capturing. Used by the frontend to detect
   practice/custom games, which Riot never indexes in Match-V5 (so those VODs
   must not be created as "pending"). Cleared at every start_recording. */
static LAST_GAME_MODE: Mutex<Option<String>> = Mutex::new(None);

/* ── Live Client Data API event capture ─────────────────────────────
   The Riot match timeline endpoint can take minutes (or hours) to be
   indexed after a game ends. The in-game Live Client Data API on
   127.0.0.1:2999 exposes the same kill/objective events in real time,
   so we poll it while recording and dump a sibling `.events.json`
   next to the video. The frontend prefers this file for an instant
   timeline and only falls back to the backend when it is missing. */

fn lcd_client() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .ok()
}

fn lcd_get_json(client: &reqwest::blocking::Client, path: &str) -> Option<serde_json::Value> {
    let url = format!("https://127.0.0.1:2999{}", path);
    let resp = client.get(&url).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<serde_json::Value>().ok()
}

fn fmt_mmss(sec: f64) -> String {
    let total = sec.max(0.0).floor() as u64;
    format!("{}:{:02}", total / 60, total % 60)
}

fn start_event_capture(output_path: String) {
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let handle_stop = Arc::clone(&stop);
    let builder = std::thread::Builder::new().name("lcd-events".into());
    let spawned = builder.spawn(move || run_event_capture(output_path, handle_stop));
    if let Ok(handle) = spawned {
        let mut guard = EVENT_CAPTURE.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(EventCaptureHandle { stop });
        std::mem::forget(handle);
    }
}

fn stop_event_capture() {
    if let Ok(guard) = EVENT_CAPTURE.lock() {
        if let Some(ref handle) = *guard {
            handle.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

/* Extracts a thumbnail frame from the still-being-written mp4 a few seconds
   in. The file is fragmented while ffmpeg runs, so seeking by index is
   impossible: we seek from the END of the decode chain (-i before -ss) and
   retry a few times until enough video data has been written. Failures are
   silently ignored and the VOD keeps its placeholder. */
fn start_thumbnail_worker(output_path: String, ffmpeg_path: String) {
    let spawned = std::thread::Builder::new().name("vod-thumb".into()).spawn(move || {
        let mut thumb = std::path::PathBuf::from(&output_path);
        thumb.set_extension("thumb.jpg");
        for delay in [7u64, 6, 9] {
            std::thread::sleep(std::time::Duration::from_secs(delay));
            if thumb.exists() {
                return;
            }
            if std::fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0) < 400 * 1024 {
                continue;
            }
            let status = Command::new(&ffmpeg_path)
                .args([
                    "-y".to_string(),
                    "-i".to_string(), output_path.clone(),
                    "-ss".to_string(), "4".to_string(),
                    "-frames:v".to_string(), "1".to_string(),
                    "-q:v".to_string(), "4".to_string(),
                ])
                .arg(&thumb)
                .creation_flags(0x08000000)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
            if thumb.exists() {
                return;
            }
            if status.map(|s| !s.success()).unwrap_or(true) {
                // ffmpeg itself failed: the recording is likely gone, stop retrying.
                return;
            }
        }
    });
    if let Ok(handle) = spawned {
        std::mem::forget(handle);
    }
}

fn run_event_capture(output_path: String, stop: Arc<std::sync::atomic::AtomicBool>) {
    let client = match lcd_client() {
        Some(c) => c,
        None => return,
    };

    /* Phase 1: roster + local player. Retries because the LCD port comes
       up slightly after the recording starts. */
    let mut players_json: Vec<serde_json::Value> = Vec::new();
    let mut name_team: std::collections::HashMap<String, i64> =
        std::collections::HashMap::new();
    let mut me_name = String::new();

    for attempt in 0..25u32 {
        if stop.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        if let Some(list) = lcd_get_json(&client, "/liveclientdata/playerlist") {
            if let Some(arr) = list.as_array() {
                for p in arr {
                    let team = match p.get("team").and_then(|v| v.as_str()) {
                        Some("ORDER") => 100i64,
                        Some("CHAOS") => 200i64,
                        _ => continue,
                    };
                    let champion = p
                        .get("championName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let summoner = p
                        .get("summonerName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let riot_name = p
                        .get("riotIdGameName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    for key in [summoner.to_lowercase(), riot_name.to_lowercase()] {
                        if !key.is_empty() {
                            name_team.insert(key, team);
                        }
                    }
                    players_json.push(serde_json::json!({
                        "name": if riot_name.is_empty() { summoner.clone() } else { riot_name.clone() },
                        "champion": champion,
                        "team": team,
                        "is_player": false,
                    }));
                }
            }
        }
        // Grab the game mode early (same retry cadence as the roster) so the
        // frontend can tell practice/custom games apart from indexed ones.
        {
            let known = LAST_GAME_MODE
                .lock()
                .map(|g| g.is_some())
                .unwrap_or(true);
            if !known {
                if let Some(gs) = lcd_get_json(&client, "/liveclientdata/gamestats") {
                    let mode = gs.get("gameMode").and_then(|v| v.as_str()).unwrap_or("");
                    let gtype = gs.get("gameType").and_then(|v| v.as_str()).unwrap_or("");
                    if !mode.is_empty() || !gtype.is_empty() {
                        if let Ok(mut g) = LAST_GAME_MODE.lock() {
                            *g = Some(format!("{}\t{}", mode, gtype));
                        }
                    }
                }
            }
        }
        if !players_json.is_empty() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(
            if attempt < 3 { 500 } else { 1500 },
        ));
    }

    if players_json.is_empty() {
        return; // never got a roster; frontend falls back to the backend
    }

    /* The local player name needs retries: right after champ select the
       endpoint can 404 briefly. NOTE: the LCD API returns Riot IDs with the
       tag ("name#TAG") while roster/event names carry only the game name —
       strip the tag or every is_player check fails. */
    for _ in 0..8u32 {
        if stop.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }
        if let Some(ap) = lcd_get_json(&client, "/liveclientdata/activeplayer") {
            let summoner = ap
                .get("summonerName")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let riot = ap
                .get("riotId")
                .map(|r| {
                    r.get("gameName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                })
                .unwrap_or("");
            let raw = if !riot.is_empty() { riot } else { summoner };
            me_name = raw.split('#').next().unwrap_or("").trim().to_string();
            if !me_name.is_empty() {
                let me_key = me_name.to_lowercase();
                for p in players_json.iter_mut() {
                    let is_me = p
                        .get("name")
                        .and_then(|v| v.as_str())
                        .map(|n| n.to_lowercase() == me_key)
                        .unwrap_or(false);
                    if let Some(obj) = p.as_object_mut() {
                        obj.insert("is_player".into(), serde_json::json!(is_me));
                    }
                }
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(700));
    }

    /* Phase 2: poll events until the flag drops or the game ends. */
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut events_json: Vec<serde_json::Value> = Vec::new();
    let mut max_time = 0.0f64;
    let mut game_ended = false;

    while !stop.load(std::sync::atomic::Ordering::SeqCst) && !game_ended {
        if let Some(data) = lcd_get_json(&client, "/liveclientdata/eventdata") {
            if let Some(arr) = data.get("Events").and_then(|v| v.as_array()) {
                for ev in arr {
                    let id = ev
                        .get("EventID")
                        .map(|v| v.to_string())
                        .unwrap_or_default();
                    let name = ev
                        .get("EventName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let time = ev
                        .get("EventTime")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    let key = if id.is_empty() {
                        format!("{}@{}", name, time)
                    } else {
                        id
                    };
                    if !seen.insert(key) {
                        continue;
                    }
                    max_time = max_time.max(time);
                    if name == "GameEnd" {
                        game_ended = true;
                        break;
                    }

                    let killer = ev
                        .get("KillerName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let victim = ev
                        .get("VictimName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    let kteam = name_team
                        .get(&killer.to_lowercase())
                        .copied();
                    let vteam = name_team
                        .get(&victim.to_lowercase())
                        .copied();
                    // Team of the actor: the killer's side, or the opposite
                    // tower/inhibitor's owner when only the victim is known.
                    let team = kteam.or_else(|| vteam.map(|t| if t == 100 { 200 } else { 100 }));

                    let mapped = match name {
                        "ChampionKill" => {
                            if team.is_none() {
                                continue;
                            }
                            let assists = ev
                                .get("Assisters")
                                .and_then(|v| v.as_array())
                                .map(|a| {
                                    a.iter()
                                        .filter_map(|n| n.as_str())
                                        .map(|n| serde_json::json!({
                                            "name": n,
                                            "is_player": !me_name.is_empty()
                                                && n.to_lowercase() == me_name.to_lowercase(),
                                        }))
                                        .collect::<Vec<_>>()
                                })
                                .unwrap_or_default();
                            serde_json::json!({
                                "type": "kill",
                                "time": fmt_mmss(time),
                                "team": team.unwrap_or(0),
                                "killer": {
                                    "name": killer,
                                    "is_player": !me_name.is_empty()
                                        && killer.to_lowercase() == me_name.to_lowercase(),
                                },
                                "victim": {
                                    "name": victim,
                                    "is_player": !me_name.is_empty()
                                        && victim.to_lowercase() == me_name.to_lowercase(),
                                },
                                "assisters": assists,
                            })
                        }
                        "TurretKilled" | "InhibKilled" => {
                            if team.is_none() {
                                continue;
                            }
                            serde_json::json!({
                                "type": "building",
                                "time": fmt_mmss(time),
                                "team": team.unwrap_or(0),
                                "building": if name == "InhibKilled" { "INHIBITOR" } else { "TOWER" },
                            })
                        }
                        "DragonKill" | "HeraldKill" | "BaronKill" | "AtakhanKill" => {
                            if team.is_none() {
                                continue;
                            }
                            let monster = match name {
                                "BaronKill" => "BARON_NASHOR",
                                "DragonKill" => "DRAGON",
                                "HeraldKill" => "RIFTHERALD",
                                _ => "ATAKHAN",
                            };
                            serde_json::json!({
                                "type": "objective",
                                "time": fmt_mmss(time),
                                "team": team.unwrap_or(0),
                                "monster": monster,
                            })
                        }
                        _ => continue,
                    };
                    events_json.push(mapped);
                }
            }
        }
        let mut slept = 0u64;
        while slept < 1500
            && !stop.load(std::sync::atomic::Ordering::SeqCst)
        {
            std::thread::sleep(std::time::Duration::from_millis(250));
            slept += 250;
        }
    }

    if events_json.is_empty() {
        return;
    }

    let payload = serde_json::json!({
        "version": 1,
        "duration_min": (max_time / 60.0 * 10.0).round() / 10.0,
        "me": me_name,
        "players": players_json,
        "events": events_json,
    });

    let mut events_file = std::path::PathBuf::from(&output_path);
    events_file.set_extension("events.json");
    if let Ok(json) = serde_json::to_string_pretty(&payload) {
        let _ = std::fs::write(&events_file, json);
    }
}

fn find_lol_window_rect() -> Option<(i32, i32, i32, i32)> {
    use std::ffi::c_void;
    type HWND = *mut c_void;
    type BOOL = i32;
    type LPARAM = isize;
    type WNDENUMPROC = Option<unsafe extern "system" fn(HWND, LPARAM) -> BOOL>;

    #[repr(C)]
    struct RECT { left: i32, top: i32, right: i32, bottom: i32 }

    extern "system" {
        fn EnumWindows(lpEnumFunc: WNDENUMPROC, lParam: LPARAM) -> BOOL;
        fn GetWindowTextW(hWnd: HWND, lpString: *mut u16, nMaxCount: i32) -> i32;
        fn IsWindowVisible(hWnd: HWND) -> BOOL;
        fn GetWindowRect(hWnd: HWND, lpRect: *mut RECT) -> BOOL;
    }

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let mut buf = [0u16; 256];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 256);
        if len > 0 && IsWindowVisible(hwnd) != 0 {
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title.contains("League of Legends (TM) Client") {
                let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                if GetWindowRect(hwnd, &mut rect) != 0 {
                    let slot = &*(lparam as *const Mutex<Option<(i32, i32, i32, i32)>>);
                    if let Ok(mut guard) = slot.lock() {
                        *guard = Some((rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top));
                    }
                }
                return 0;
            }
        }
        1
    }

    let result: Mutex<Option<(i32, i32, i32, i32)>> = Mutex::new(None);
    let ptr = &result as *const Mutex<Option<(i32, i32, i32, i32)>> as LPARAM;

    unsafe {
        let _ = EnumWindows(Some(callback), ptr);
    }

    result.lock().ok().and_then(|mut g| g.take())
}

#[derive(Serialize)]
struct RiotSession {
    game_name: String,
    game_tag: String,
    puuid: String,
    region: String,
}

#[derive(Serialize)]
struct RiotSessionResult {
    ok: bool,
    error: Option<String>,
    session: Option<RiotSession>,
}

fn find_riot_client_lockfile() -> Option<std::path::PathBuf> {
    let local_app_data = std::env::var("LOCALAPPDATA").ok()?;
    let primary = std::path::Path::new(&local_app_data)
        .join("Riot Games")
        .join("Riot Client")
        .join("Config")
        .join("lockfile");
    if primary.is_file() {
        return Some(primary);
    }

    let program_data =
        std::env::var("PROGRAMDATA").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    let installs_path = std::path::Path::new(&program_data)
        .join("Riot Games")
        .join("RiotClientInstalls.json");
    let installs_text = std::fs::read_to_string(installs_path).ok()?;
    let installs: serde_json::Value = serde_json::from_str(&installs_text).ok()?;
    for key in ["rc_default", "rc_live", "installed_path"] {
        let Some(value) = installs.get(key).and_then(|v| v.as_str()) else {
            continue;
        };
        let path = std::path::Path::new(value);
        let dir = if path.extension().is_some() {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        for candidate in [dir.join("Config").join("lockfile"), dir.join("Lockfile")] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn read_riot_session() -> RiotSessionResult {
    let lockfile = match find_riot_client_lockfile() {
        Some(path) => path,
        None => {
            return RiotSessionResult {
                ok: false,
                error: Some(
                    "No se encontró la lockfile del Riot Client. Asegúrate de tenerlo abierto."
                        .to_string(),
                ),
                session: None,
            }
        }
    };
    let lockfile_text = match std::fs::read_to_string(&lockfile) {
        Ok(text) => text,
        Err(err) => {
            return RiotSessionResult {
                ok: false,
                error: Some(format!("No se pudo leer la lockfile: {err}")),
                session: None,
            }
        }
    };
    let parts: Vec<&str> = lockfile_text.trim().split(':').collect();
    if parts.len() < 5 {
        return RiotSessionResult {
            ok: false,
            error: Some("La lockfile tiene un formato inesperado.".to_string()),
            session: None,
        };
    }
    let port = parts[2];
    let password = parts[3];

    let client = reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .unwrap_or_else(|_| reqwest::blocking::Client::new());
    let url = format!("https://127.0.0.1:{port}/chat/v1/session");
    let resp = match client
        .get(&url)
        .basic_auth("riot", Some(password))
        .timeout(std::time::Duration::from_secs(3))
        .send()
    {
        Ok(resp) => resp,
        Err(err) => {
            return RiotSessionResult {
                ok: false,
                error: Some(format!("El cliente no respondió en el puerto {port}: {err}")),
                session: None,
            }
        }
    };
    if !resp.status().is_success() {
        return RiotSessionResult {
            ok: false,
            error: Some(format!("El cliente respondió con estado {}.", resp.status())),
            session: None,
        };
    }
    let body: serde_json::Value = match resp.json() {
        Ok(value) => value,
        Err(_) => {
            return RiotSessionResult {
                ok: false,
                error: Some("El cliente devolvió una respuesta no válida.".to_string()),
                session: None,
            }
        }
    };
    let text = |key: &str| {
        body.get(key)
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string()
    };
    let session = RiotSession {
        game_name: text("game_name"),
        game_tag: text("game_tag"),
        puuid: text("puuid"),
        region: text("region"),
    };
    if session.puuid.is_empty() {
        return RiotSessionResult {
            ok: false,
            error: Some("No hay una sesión iniciada en el Riot Client.".to_string()),
            session: None,
        };
    }
    RiotSessionResult {
        ok: true,
        error: None,
        session: Some(session),
    }
}

#[tauri::command]
async fn get_riot_client_session() -> RiotSessionResult {
    match tauri::async_runtime::spawn_blocking(read_riot_session).await {
        Ok(result) => result,
        Err(_) => RiotSessionResult {
            ok: false,
            error: Some("No se pudo detectar el Riot Client.".to_string()),
            session: None,
        },
    }
}

#[tauri::command]
async fn open_vod_folder(path: Option<String>) -> Result<(), String> {
    let folder = path.unwrap_or_else(|| {
        let local = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
        std::path::Path::new(&local)
            .join("Videos")
            .join("RiftHelper")
            .to_string_lossy()
            .to_string()
    });
    let _ = std::fs::create_dir_all(&folder);
    opener::open(&folder).map_err(|e| e.to_string())
}

#[tauri::command]
async fn show_in_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.is_file() {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", p.to_string_lossy()))
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    } else if p.is_dir() {
        opener::open(p).map_err(|e| e.to_string())
    } else {
        let default = get_default_vod_folder().await;
        std::fs::create_dir_all(&default).map_err(|e| e.to_string())?;
        opener::open(&default).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn select_vod_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let result = app
        .dialog()
        .file()
        .set_title("Seleccionar carpeta de grabs")
        .blocking_pick_folder();
    Ok(result.and_then(|p| p.into_path().ok()).map(|p| p.display().to_string()))
}

#[tauri::command]
async fn get_default_vod_folder() -> String {
    let local = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    std::path::Path::new(&local)
        .join("Videos")
        .join("RiftHelper")
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
async fn toggle_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| e.to_string())?;
    } else {
        autostart.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let autostart = app.autolaunch();
    Ok(autostart.is_enabled().unwrap_or(false))
}

fn config_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_config_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    std::fs::create_dir_all(&dir).ok();
    dir.join("config.json")
}

fn read_config(app: &tauri::AppHandle) -> serde_json::Value {
    let path = config_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}))
}

fn write_config(app: &tauri::AppHandle, cfg: &serde_json::Value) {
    let path = config_path(app);
    if let Ok(s) = serde_json::to_string_pretty(cfg) {
        std::fs::write(path, s).ok();
    }
}

#[tauri::command]
async fn get_close_behavior(app: tauri::AppHandle) -> Result<String, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("closeBehavior")
        .and_then(|v| v.as_str())
        .unwrap_or("tray")
        .to_string())
}

#[tauri::command]
async fn set_close_behavior(app: tauri::AppHandle, behavior: String) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg["closeBehavior"] = serde_json::json!(behavior);
    write_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
async fn get_ffmpeg_path(app: tauri::AppHandle) -> Result<String, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("ffmpegPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

#[tauri::command]
async fn set_ffmpeg_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg["ffmpegPath"] = serde_json::json!(path);
    write_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
async fn get_recordings_folder(app: tauri::AppHandle) -> Result<String, String> {
    let cfg = read_config(&app);
    if let Some(folder) = cfg.get("recordingsFolder").and_then(|v| v.as_str()) {
        return Ok(folder.to_string());
    }
    Ok(default_recordings_folder())
}

fn default_recordings_folder() -> String {
    let local = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    std::path::Path::new(&local)
        .join("Videos")
        .join("RiftHelper")
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
async fn set_recordings_folder(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg["recordingsFolder"] = serde_json::json!(folder);
    write_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
async fn select_recordings_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let result = app
        .dialog()
        .file()
        .set_title("Seleccionar carpeta de grabaciones")
        .blocking_pick_folder();
    Ok(result.and_then(|p| p.into_path().ok()).map(|p| p.display().to_string()))
}

#[tauri::command]
async fn select_ffmpeg_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let result = app
        .dialog()
        .file()
        .set_title("Seleccionar ffmpeg.exe")
        .add_filter("FFmpeg", &["exe"])
        .blocking_pick_file();
    Ok(result.and_then(|p| p.into_path().ok()).map(|p| p.display().to_string()))
}

#[tauri::command]
async fn test_ffmpeg(path: String) -> Result<bool, String> {
    let output = Command::new(&path)
        .arg("-version")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(output.status.success())
}

#[tauri::command]
async fn get_auto_record(app: tauri::AppHandle) -> Result<bool, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("autoRecord")
        .and_then(|v| v.as_bool())
        .unwrap_or(true))
}

#[tauri::command]
async fn set_auto_record(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg["autoRecord"] = serde_json::json!(enabled);
    write_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
async fn get_audio_mode(app: tauri::AppHandle) -> Result<String, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("audioMode")
        .and_then(|v| v.as_str())
        .unwrap_or("game")
        .to_string())
}

#[tauri::command]
async fn set_audio_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    let normalized = match mode.as_str() {
        "system" => "system",
        "game_discord" => "game_discord",
        _ => "game",
    };
    let mut cfg = read_config(&app);
    cfg["audioMode"] = serde_json::json!(normalized);
    write_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
async fn list_audio_output_devices() -> Result<Vec<serde_json::Value>, String> {
    let devices = unsafe { list_render_endpoints() }?;
    Ok(devices
        .into_iter()
        .map(|(id, name, is_default)| {
            serde_json::json!({ "id": id, "name": name, "isDefault": is_default })
        })
        .collect())
}

#[tauri::command]
async fn get_audio_output_device(app: tauri::AppHandle) -> Result<String, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("audioOutputDevice")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

#[tauri::command]
async fn set_audio_output_device(app: tauri::AppHandle, device_id: String) -> Result<(), String> {
    // Empty string means "follow the system default".
    let normalized = device_id.trim().to_string();
    if !normalized.is_empty() {
        let known = unsafe { list_render_endpoints() }?
            .into_iter()
            .any(|(id, _, _)| id == normalized);
        if !known {
            return Err("Unknown audio output device".to_string());
        }
    }
    let mut cfg = read_config(&app);
    cfg["audioOutputDevice"] = serde_json::json!(normalized);
    write_config(&app, &cfg);
    Ok(())
}

/// Outcome of waiting for the in-game clock.
enum GameStartWait {
    Started,
    Timeout,
    WindowClosed,
}

/// Polls Riot's Live Client Data API (port 2999, served by the game client)
/// until the in-game session is reachable, so recordings skip champ select.
/// Port 2999 only answers once the game process is up, so the FIRST valid
/// sample means the session has begun and we roll immediately. Requiring the
/// clock to advance broke ARAM Mayhem: its intro freezes gameTime at 0 and it
/// later jumps straight to ~00:30, which made recordings start late. An
/// ambiguous first sample (mid-range time, port opened late) gets a short
/// grace window, then we record anyway — early beats missing content.
/// If the window disappears the game was cancelled/dodged.
fn wait_for_game_start(max_secs: u64) -> GameStartWait {
    let client = match reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
    {
        Ok(c) => c,
        Err(_) => return GameStartWait::Timeout,
    };
    let url = "https://127.0.0.1:2999/liveclientdata/gamestats";
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(max_secs);
    let mut last_t: Option<f64> = None;
    let mut missing = 0u32;
    let mut grace = 0u32;
    while std::time::Instant::now() < deadline {
        let sample = client
            .get(url)
            .timeout(std::time::Duration::from_millis(600))
            .send()
            .ok()
            .and_then(|r| r.json::<serde_json::Value>().ok())
            .and_then(|v| v.get("gameTime").and_then(|t| t.as_f64()));
        match sample {
            Some(t) => {
                let roll = match last_t {
                    // First contact: near 00:00 or clearly a mid-game join.
                    None => t <= 5.0 || t >= 90.0,
                    // Later samples: any sign of the clock moving.
                    Some(prev) => t > prev + 0.4,
                };
                if roll {
                    return GameStartWait::Started;
                }
                // Ambiguous frozen time: don't wait forever on it.
                grace += 1;
                if grace >= 4 {
                    return GameStartWait::Started;
                }
                last_t = Some(t);
            }
            None => {
                last_t = None;
                // A vanished window means the lobby was dodged/cancelled.
                if find_lol_window_rect().is_none() {
                    missing += 1;
                    if missing >= 6 {
                        return GameStartWait::WindowClosed;
                    }
                } else {
                    missing = 0;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
    GameStartWait::Timeout
}

/* ── Audio capture ────────────────────────────────────────────
   Modes:
   - "game"         : WASAPI process loopback of the LoL game process only
   - "game_discord" : process loopback of game + Discord trees, mixed by ffmpeg
   - "system"       : WASAPI loopback of a render output device (default or
                      user-picked), captured natively
   All PCM is streamed into ffmpeg through Windows named pipes so no audio
   indev support is required and stop is instant (pipe close). */

#[derive(Clone, Copy, PartialEq)]
enum AudioMode {
    Game,
    System,
    GameDiscord,
}

fn audio_mode_from_cfg(cfg: &serde_json::Value) -> AudioMode {
    match cfg.get("audioMode").and_then(|v| v.as_str()) {
        Some("system") => AudioMode::System,
        Some("game_discord") => AudioMode::GameDiscord,
        _ => AudioMode::Game,
    }
}

/// Where a loopback capture pulls audio from.
enum CaptureSource {
    /// WASAPI process-loopback of a single PID tree.
    Process(u32),
    /// Render-endpoint loopback (None = whatever the system default is now).
    Endpoint(Option<String>),
}

fn pcwstr_to_string(p: windows::core::PCWSTR) -> String {
    if p.0.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    unsafe {
        while *p.0.add(len) != 0 {
            len += 1;
        }
    }
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(p.0, len) })
}

/// All active render endpoints, with the current default flagged. Used by the
/// settings UI dropdown and to resolve a stored endpoint id at record time.
unsafe fn list_render_endpoints() -> Result<Vec<(String, String, bool)>, String> {
    use windows::Win32::Media::Audio::{
        DEVICE_STATE_ACTIVE, IMMDeviceEnumerator, MMDeviceEnumerator, eConsole, eRender,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| format!("mmdev: {e}"))?;
    let default_id = enumerator
        .GetDefaultAudioEndpoint(eRender, eConsole)
        .ok()
        .and_then(|d| d.GetId().ok())
        .map(|v| pcwstr_to_string(windows::core::PCWSTR(v.0)));

    let coll = enumerator
        .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
        .map_err(|e| format!("enum: {e}"))?;
    let count = coll.GetCount().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for i in 0..count {
        let dev = match coll.Item(i) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let id = match dev.GetId() {
            Ok(v) => pcwstr_to_string(windows::core::PCWSTR(v.0)),
            Err(_) => continue,
        };
        let name = device_friendly_name(&dev).unwrap_or_else(|| id.clone());
        let is_default = default_id.as_deref() == Some(id.as_str());
        out.push((id, name, is_default));
    }
    out.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    Ok(out)
}

/// VT_LPWSTR reader that avoids generated union field names.
#[repr(C)]
struct RawLpwstrVariant {
    vt: u16,
    reserved: [u16; 3],
    pad: u32,
    pwsz: *mut u16,
}
const VT_LPWSTR_U16: u16 = 31;

fn propvariant_to_string(pv: &windows::core::PROPVARIANT) -> Option<String> {
    unsafe {
        let mut raw = RawLpwstrVariant {
            vt: 0,
            reserved: [0u16; 3],
            pad: 0,
            pwsz: std::ptr::null_mut(),
        };
        std::ptr::copy_nonoverlapping(
            pv as *const windows::core::PROPVARIANT as *const u8,
            &mut raw as *mut RawLpwstrVariant as *mut u8,
            std::mem::size_of::<RawLpwstrVariant>(),
        );
        if raw.vt != VT_LPWSTR_U16 || raw.pwsz.is_null() {
            return None;
        }
        Some(pcwstr_to_string(windows::core::PCWSTR(raw.pwsz)))
    }
}

fn looks_like_device_id(s: &str) -> bool {
    s.starts_with('{') || s.contains(".{") || s.contains('\\')
}

fn device_friendly_name(
    dev: &windows::Win32::Media::Audio::IMMDevice,
) -> Option<String> {
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::System::Com::STGM_READ;

    unsafe {
        let store = dev.OpenPropertyStore(STGM_READ).ok()?;
        let mut pv: windows::core::PROPVARIANT = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
        let s = propvariant_to_string(&pv);
        let _ = windows::Win32::System::Com::StructuredStorage::PropVariantClear(&mut pv);
        s.filter(|s| !s.is_empty() && !looks_like_device_id(s))
    }
}

/// Open a loopback IAudioClient on a render endpoint (system-wide capture).
unsafe fn open_endpoint_loopback_client(
    endpoint_id: Option<String>,
) -> Result<windows::Win32::Media::Audio::IAudioClient, String> {
    use windows::Win32::Media::Audio::{
        DEVICE_STATE_ACTIVE, IMMDeviceEnumerator, MMDeviceEnumerator, eConsole, eRender,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| format!("mmdev: {e}"))?;

    let device = match endpoint_id {
        Some(id) => {
            // Resolve the stored id; silently fall back to the current
            // default when the saved device no longer exists.
            let mut found = None;
            if let Ok(coll) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                if let Ok(count) = coll.GetCount() {
                    for i in 0..count {
                        if let Ok(d) = coll.Item(i) {
                            if let Ok(did) = d.GetId() {
                                if pcwstr_to_string(windows::core::PCWSTR(did.0)) == id {
                                    found = Some(d);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            match found {
                Some(d) => d,
                None => enumerator
                    .GetDefaultAudioEndpoint(eRender, eConsole)
                    .map_err(|e| format!("default endpoint: {e}"))?,
            }
        }
        None => enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("default endpoint: {e}"))?,
    };

    device
        .Activate::<windows::Win32::Media::Audio::IAudioClient>(CLSCTX_ALL, None)
        .map_err(|e| format!("activate endpoint: {e}"))
}

/// PID of the visible "League of Legends (TM) Client" window (the actual game).
fn find_lol_window_pid() -> Option<u32> {
    use std::ffi::c_void;
    type HWND = *mut c_void;
    type BOOL = i32;
    type LPARAM = isize;
    type WNDENUMPROC = Option<unsafe extern "system" fn(HWND, LPARAM) -> BOOL>;

    extern "system" {
        fn EnumWindows(lpEnumFunc: WNDENUMPROC, lParam: LPARAM) -> BOOL;
        fn GetWindowTextW(hWnd: HWND, lpString: *mut u16, nMaxCount: i32) -> i32;
        fn IsWindowVisible(hWnd: HWND) -> BOOL;
        fn GetWindowThreadProcessId(hWnd: HWND, lpdwProcessId: *mut u32) -> u32;
    }

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let mut buf = [0u16; 256];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 256);
        if len > 0 && IsWindowVisible(hwnd) != 0 {
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title.contains("League of Legends (TM) Client") {
                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, &mut pid);
                let slot = &*(lparam as *const Mutex<Option<u32>>);
                if let Ok(mut guard) = slot.lock() {
                    *guard = Some(pid);
                }
                return 0;
            }
        }
        1
    }

    let result: Mutex<Option<u32>> = Mutex::new(None);
    let ptr = &result as *const Mutex<Option<u32>> as LPARAM;
    unsafe {
        let _ = EnumWindows(Some(callback), ptr);
    }
    result.lock().ok().and_then(|mut g| g.take())
}

/// PIDs whose image name contains `needle` (case-insensitive), skipping updaters.
fn find_process_pids_by_image(needle_lower: &str, max: usize) -> Vec<u32> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    let mut out = Vec::new();
    unsafe {
        let snap = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return out,
        };
        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut entry).is_ok();
        while ok && out.len() < max {
            let name = String::from_utf16_lossy(&entry.szExeFile)
                .trim_end_matches('\0')
                .to_lowercase();
            if !name.is_empty() && name.contains(needle_lower) && !name.contains("updater") {
                out.push(entry.th32ProcessID);
            }
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            ok = Process32NextW(snap, &mut entry).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}

struct StartGate {
    done: Mutex<bool>,
    cv: std::sync::Condvar,
}

impl StartGate {
    fn new() -> Self {
        StartGate { done: Mutex::new(false), cv: std::sync::Condvar::new() }
    }
    /// Blocks until opened; returns false early if cancelled.
    fn wait_with_cancel(&self, cancel: &std::sync::atomic::AtomicBool) -> bool {
        let mut g = self.done.lock().unwrap();
        while !*g {
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                return false;
            }
            let (ng, to) = self
                .cv
                .wait_timeout(g, std::time::Duration::from_millis(200))
                .unwrap();
            g = ng;
            if !to.timed_out() {
                return *g || cancel.load(std::sync::atomic::Ordering::Relaxed);
            }
        }
        true
    }
    fn open(&self) {
        *self.done.lock().unwrap() = true;
        self.cv.notify_all();
    }
}

const VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK: &str =
    "{4E851656-72BA-46E9-BB12-27BCD95BD16B}";

/* Flat ABI mirror of AUDIOCLIENT_ACTIVATION_PARAMS (layout fixed by WinABI:
   ActivationType u32 @0 + union{ ProcessLoopbackTarget{ u32 pid @4, i32 mode @8 } }). */
#[repr(C)]
struct AudioActivationParamsRaw {
    activation_type: i32, // 1 = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
    target_process_id: u32,
    loopback_mode: i32, // 1 = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
}

#[windows::core::implement(
    windows::Win32::Media::Audio::IActivateAudioInterfaceCompletionHandler,
    windows::Win32::System::Com::IAgileObject
)]
struct ActivationSignal {
    event: windows::Win32::Foundation::HANDLE,
    result_code: std::sync::Arc<std::sync::atomic::AtomicI32>,
    client: std::sync::Arc<std::sync::Mutex<Option<windows::Win32::Media::Audio::IAudioClient>>>,
}

impl windows::Win32::Media::Audio::IActivateAudioInterfaceCompletionHandler_Impl
    for ActivationSignal_Impl
{
    fn ActivateCompleted(
        &self,
        activateoperation: Option<
            &windows::Win32::Media::Audio::IActivateAudioInterfaceAsyncOperation,
        >,
    ) -> windows::core::Result<()> {
        unsafe {
            if let Some(op) = activateoperation {
                let mut hr = windows::core::HRESULT(0);
                let mut unk: Option<windows::core::IUnknown> = None;
                if op.GetActivateResult(&mut hr, &mut unk).is_ok() {
                    self.result_code
                        .store(hr.0, std::sync::atomic::Ordering::SeqCst);
                    if let Ok(mut guard) = self.client.lock() {
                        *guard = unk.and_then(|u| {
                            windows::core::Interface::cast::<windows::Win32::Media::Audio::IAudioClient>(&u).ok()
                        });
                    }
                }
            }
            let _ = windows::Win32::System::Threading::SetEvent(self.event);
        }
        Ok(())
    }
}

impl windows::Win32::System::Com::IAgileObject_Impl for ActivationSignal_Impl {}

unsafe fn activate_process_loopback_client(
    pid: u32,
) -> Result<windows::Win32::Media::Audio::IAudioClient, String> {
    use windows::core::{HSTRING, Interface, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::Media::Audio::{
        ActivateAudioInterfaceAsync, IActivateAudioInterfaceCompletionHandler, IAudioClient,
    };
    use windows::Win32::System::Com::CoInitializeEx;
    use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

    let _ = CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);

    // Build the activation PROPVARIANT (VT_BLOB wrapping the params struct).
    // Built via the official helper: hand-rolling the variant previously put
    // cbSize at the wrong struct offset, sending a size-0 blob through
    // mmdevapi's marshaling and corrupting the heap (0xc0000374 crash a few
    // seconds into every recording).
    const _: () =
        assert!(std::mem::size_of::<AudioActivationParamsRaw>() == 12);
    let params = AudioActivationParamsRaw {
        activation_type: 1,
        target_process_id: pid,
        loopback_mode: 1,
    };
    let params_ptr = &params as *const AudioActivationParamsRaw as *const core::ffi::c_void;
    let mut propvar = windows::Win32::System::Com::StructuredStorage::InitPropVariantFromBuffer(
        params_ptr,
        std::mem::size_of::<AudioActivationParamsRaw>() as u32,
    )
    .map_err(|e| format!("propvariant: {e}"))?;

    let event = CreateEventW(None, false, false, None).map_err(|e| e.to_string())?;
    let result_flag = std::sync::Arc::new(std::sync::atomic::AtomicI32::new(-1));
    let client_slot: std::sync::Arc<std::sync::Mutex<Option<IAudioClient>>> =
        std::sync::Arc::new(std::sync::Mutex::new(None));
    let signal = ActivationSignal {
        event,
        result_code: result_flag.clone(),
        client: client_slot.clone(),
    };
    let handler: IActivateAudioInterfaceCompletionHandler = signal.into();

    let device_path = HSTRING::from(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK);
    // Keep the operation alive until the completion event fires.
    let operation = ActivateAudioInterfaceAsync(
        PCWSTR::from_raw(device_path.as_ptr()),
        &IAudioClient::IID,
        Some(&propvar),
        &handler,
    )
    .map_err(|e| format!("activate: {e}"))?;

    let waited = WaitForSingleObject(event, 4000);
    let hr = result_flag.load(std::sync::atomic::Ordering::SeqCst);
    let client = client_slot.lock().ok().and_then(|mut g| g.take());
    let _ = CloseHandle(event);
    drop(operation);
    PropVariantClear(&mut propvar).ok();
    if waited != WAIT_OBJECT_0 {
        return Err("audio activation timed out".to_string());
    }
    if hr != 0 {
        return Err(format!("audio activation failed: hr=0x{hr:08X}"));
    }
    client.ok_or_else(|| "audio activation returned no client".to_string())
}

/// One loopback source: captures PCM and writes it into a named pipe
/// that ffmpeg reads as a raw audio input.
fn spawn_capture_source(
    source: CaptureSource,
    pipe_name: String,
) -> (
    std::sync::mpsc::Receiver<Result<(String, u32, u16, u16), String>>,
    Arc<StartGate>,
    Arc<std::sync::atomic::AtomicBool>,
) {
    let (tx, rx) = std::sync::mpsc::channel();
    let gate = Arc::new(StartGate::new());
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let gate2 = gate.clone();
    let cancel2 = cancel.clone();
    std::thread::spawn(move || unsafe {
        use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
        use windows::Win32::Media::Audio::{IAudioCaptureClient, AUDCLNT_SHAREMODE_SHARED, WAVEFORMATEX};
        use windows::Win32::Storage::FileSystem::{FILE_FLAGS_AND_ATTRIBUTES, FlushFileBuffers};
        use windows::Win32::System::Com::CoTaskMemFree;
        use windows::Win32::System::Pipes::{
            ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, NAMED_PIPE_MODE,
        };
        use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};

        const STREAM_FLAGS: u32 = 0x0002_0000 | 0x0004_0000; // LOOPBACK | EVENTCALLBACK

        let fail = |msg: String| {
            let _ = tx.send(Err(msg));
        };

        let client = match match source {
            CaptureSource::Process(pid) => activate_process_loopback_client(pid),
            CaptureSource::Endpoint(id) => open_endpoint_loopback_client(id),
        } {
            Ok(c) => c,
            Err(e) => return fail(e),
        };

        let pwfx = match client.GetMixFormat() {
            Ok(p) if !p.is_null() => p,
            Ok(_) => return fail("mixformat null".to_string()),
            Err(e) => return fail(format!("mixformat: {e}")),
        };
        let tag = (*pwfx).wFormatTag;
        let channels = (*pwfx).nChannels.max(1);
        let rate = (*pwfx).nSamplesPerSec.max(8000);
        let bits = (*pwfx).wBitsPerSample.max(8);
        let block_align = ((*pwfx).nBlockAlign as usize).max(1);
        let extensible = tag == 0xFFFE;
        let float = tag == 3 || (extensible && bits == 32);
        let fmt_name = if float { "f32le" } else { "s16le" }.to_string();

        let ev = match CreateEventW(None, false, false, None) {
            Ok(h) => h,
            Err(e) => return fail(format!("event: {e}")),
        };

        if let Err(e) = client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            STREAM_FLAGS,
            2_000_000, // ~200ms buffer (100ns units)
            0,
            pwfx as *const WAVEFORMATEX,
            None,
        ) {
            return fail(format!("init: {e}"));
        }
        if let Err(e) = client.SetEventHandle(ev) {
            return fail(format!("setevent: {e}"));
        }
        let cap: IAudioCaptureClient = match client.GetService() {
            Ok(c) => c,
            Err(e) => return fail(format!("service: {e}")),
        };
        if let Err(e) = client.Start() {
            return fail(format!("start: {e}"));
        }

        // Report format so the caller can assemble ffmpeg args, then wait for
        // ffmpeg to be spawned before connecting the pipe.
        let _ = tx.send(Ok((fmt_name.clone(), rate, channels, bits)));
        if !gate2.wait_with_cancel(&cancel2) {
            let _ = client.Stop();
            return;
        }

        // Connect the server-side pipe handle (client = ffmpeg).
        let wide: Vec<u16> = pipe_name.encode_utf16().chain(Some(0)).collect();
        let pname = windows::core::PCWSTR::from_raw(wide.as_ptr());
        let pipe = CreateNamedPipeW(
            pname,
            FILE_FLAGS_AND_ATTRIBUTES(0x0000_0002 | 0x0008_0000), // OUTBOUND | FIRST_PIPE_INSTANCE
            NAMED_PIPE_MODE(0), // TYPE_BYTE | READMODE_BYTE | WAIT
            1,
            65536,
            65536,
            0,
            None,
        );
        if pipe.is_invalid() {
            let _ = client.Stop();
            return fail("createpipe failed".to_string());
        }
        if let Err(e) = ConnectNamedPipe(pipe, None) {
            // ERROR_PIPE_CONNECTED means ffmpeg already opened it: fine.
            if (e.code().0 & 0xFFFF) != 536 {
                let _ = client.Stop();
                let _ = CloseHandle(pipe);
                return fail(format!("connect: {e}"));
            }
        }

        let mut stopped = false;
        while !stopped {
            if AUDIO_CAPTURE_STOP.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            let w = WaitForSingleObject(ev, 200);
            if w != WAIT_OBJECT_0 {
                continue;
            }
            loop {
                let packets = match cap.GetNextPacketSize() {
                    Ok(p) => p,
                    Err(_) => {
                        stopped = true;
                        break;
                    }
                };
                if packets == 0 {
                    break;
                }
                let mut data: *mut u8 = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                if cap.GetBuffer(&mut data, &mut frames, &mut flags, None, None).is_err() {
                    stopped = true;
                    break;
                }
                let bytes = frames as usize * block_align;
                let ok = if flags & 0x2 != 0 || data.is_null() {
                    let zeros = vec![0u8; bytes];
                    write_all_pipe(pipe, &zeros)
                } else {
                    let slice = std::slice::from_raw_parts(data, bytes);
                    write_all_pipe(pipe, slice)
                };
                let _ = cap.ReleaseBuffer(frames);
                if !ok {
                    stopped = true;
                    break;
                }
            }
        }

        let _ = SetEvent(ev); // unblock any pending wait
        let _ = client.Stop();
        let _ = FlushFileBuffers(pipe);
        let _ = DisconnectNamedPipe(pipe);
        let _ = CloseHandle(pipe);
        let _ = CloseHandle(ev);
        if !pwfx.is_null() {
            CoTaskMemFree(Some(pwfx as *const core::ffi::c_void));
        }
    });
    (rx, gate, cancel)
}

fn write_all_pipe(pipe: windows::Win32::Foundation::HANDLE, mut buf: &[u8]) -> bool {
    while !buf.is_empty() {
        let end = buf.len().min(60_000);
        let mut written = 0u32;
        match unsafe {
            windows::Win32::Storage::FileSystem::WriteFile(
                pipe,
                Some(&buf[..end]),
                Some(&mut written),
                None,
            )
        } {
            Ok(_) => {
                if written == 0 {
                    return false;
                }
                buf = &buf[written as usize..];
            }
            Err(_) => return false,
        }
    }
    true
}

/// One resolved ffmpeg audio input (a named pipe with raw PCM).
enum AudioInput {
    /// args already contain -f/-ar/-ac/-i for a named pipe
    Pipe(Vec<String>),
}

/// Spawn one capture source on a fresh pipe; returns ffmpeg args + gate when
/// the capture client came up (format already reported by the thread).
fn add_capture_source(
    inputs: &mut Vec<AudioInput>,
    gates: &mut Vec<Arc<StartGate>>,
    name: String,
    source: CaptureSource,
) -> bool {
    unsafe {
        if !create_audio_pipe_checked(&name) {
            return false;
        }
    }
    let (rx, gate, cancel) = spawn_named_capture_thread(source, name.clone());
    match rx.recv_timeout(std::time::Duration::from_millis(5000)) {
        Ok(Ok((fmt, rate, ch, _bits))) => {
            inputs.push(AudioInput::Pipe(vec![
                "-f".into(), fmt,
                "-ar".into(), rate.to_string(),
                "-ac".into(), ch.to_string(),
                "-i".into(), name,
            ]));
            gates.push(gate);
            true
        }
        other => {
            cancel.store(true, std::sync::atomic::Ordering::Relaxed);
            gate.open();
            let _ = other;
            false
        }
    }
}

fn setup_audio_sources(
    mode: AudioMode,
    output_device_id: String,
) -> (Vec<AudioInput>, Vec<Arc<StartGate>>) {
    let mut inputs: Vec<AudioInput> = Vec::new();
    let mut gates: Vec<Arc<StartGate>> = Vec::new();

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    if matches!(mode, AudioMode::Game | AudioMode::GameDiscord) {
        if let Some(gpid) = find_lol_window_pid() {
            let name = format!(r"\\.\pipe\rh-audio-game-{ts}");
            add_capture_source(&mut inputs, &mut gates, name, CaptureSource::Process(gpid));
        }

        if mode == AudioMode::GameDiscord {
            for (i, dpid) in find_process_pids_by_image("discord", 2).into_iter().enumerate() {
                let name = format!(r"\\.\pipe\rh-audio-discord{i}-{ts}");
                add_capture_source(
                    &mut inputs,
                    &mut gates,
                    name,
                    CaptureSource::Process(dpid),
                );
            }
        }
    } else if mode == AudioMode::System {
        let id = if output_device_id.trim().is_empty() {
            None
        } else {
            Some(output_device_id)
        };
        let name = format!(r"\\.\pipe\rh-audio-system-{ts}");
        add_capture_source(
            &mut inputs,
            &mut gates,
            name,
            CaptureSource::Endpoint(id),
        );
    }

    (inputs, gates)
}

unsafe fn create_audio_pipe_checked(name: &str) -> bool {
    let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let pname = windows::core::PCWSTR::from_raw(wide.as_ptr());
    let h = windows::Win32::System::Pipes::CreateNamedPipeW(
        pname,
        windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(0x0000_0002 | 0x0008_0000),
        windows::Win32::System::Pipes::NAMED_PIPE_MODE(0),
        1,
        65536,
        65536,
        0,
        None,
    );
    if h.is_invalid() {
        return false;
    }
    // Close this placeholder instance; the capture thread re-creates
    // the same pipe (first-instance flag released on close).
    let _ = windows::Win32::Foundation::CloseHandle(h);
    true
}

// Thin wrapper so all call sites share one signature.
fn spawn_named_capture_thread(
    source: CaptureSource,
    pipe_name: String,
) -> (
    std::sync::mpsc::Receiver<Result<(String, u32, u16, u16), String>>,
    Arc<StartGate>,
    Arc<std::sync::atomic::AtomicBool>,
) {
    spawn_capture_source(source, pipe_name)
}

/* ==================== Desktop Duplication video capture ====================
   gdigrab cannot read DirectX flip-model swapchains (it returns black frames
   for the LoL client) and its BitBlt uses CAPTUREBLT, which forces Windows to
   repaint layered windows + cursor on every frame — that flag is what made
   the mouse flicker system-wide and cost CPU at game start. DXGI Desktop
   Duplication grabs the already-composited desktop straight from the GPU:
   works with the game's presentation mode, costs almost no CPU and never
   touches CAPTUREBLT. Every frame is cropped to the game client rect; black
   frames are emitted while the window is minimized or unfocused so nothing
   else ever shows up in the VOD. */

static VIDEO_CAPTURE_STOP: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
static VIDEO_MODE_DDA: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn find_lol_hwnd() -> isize {
    use std::ffi::c_void;
    type HWND = *mut c_void;
    type BOOL = i32;
    type LPARAM = isize;
    type WNDENUMPROC = Option<unsafe extern "system" fn(HWND, LPARAM) -> BOOL>;

    extern "system" {
        fn EnumWindows(lpEnumFunc: WNDENUMPROC, lParam: LPARAM) -> BOOL;
        fn GetWindowTextW(hWnd: HWND, lpString: *mut u16, nMaxCount: i32) -> i32;
        fn IsWindowVisible(hWnd: HWND) -> BOOL;
    }

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let mut buf = [0u16; 256];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 256);
        if len > 0 && IsWindowVisible(hwnd) != 0 {
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title.contains("League of Legends (TM) Client") {
                let slot = &*(lparam as *const Mutex<Option<isize>>);
                if let Ok(mut guard) = slot.lock() {
                    *guard = Some(hwnd as isize);
                }
                return 0;
            }
        }
        1
    }

    let result: Mutex<Option<isize>> = Mutex::new(None);
    let ptr = &result as *const Mutex<Option<isize>> as LPARAM;
    unsafe {
        let _ = EnumWindows(Some(callback), ptr);
    }
    result.lock().ok().and_then(|mut g| g.take()).unwrap_or(0)
}

fn lol_window_alive(hwnd: isize) -> bool {
    use std::ffi::c_void;
    type HWND = *mut c_void;
    type BOOL = i32;
    extern "system" {
        fn IsWindow(hWnd: HWND) -> BOOL;
        fn IsWindowVisible(hWnd: HWND) -> BOOL;
    }
    unsafe {
        let h = hwnd as HWND;
        IsWindow(h) != 0 && IsWindowVisible(h) != 0
    }
}

/// Client area of the window in screen coordinates (excludes borders/titlebar).
fn lol_client_rect(hwnd: isize) -> Option<(i32, i32, u32, u32)> {
    use std::ffi::c_void;
    type HWND = *mut c_void;
    type BOOL = i32;

    #[repr(C)]
    struct RECT { left: i32, top: i32, right: i32, bottom: i32 }
    #[repr(C)]
    struct POINT { x: i32, y: i32 }

    extern "system" {
        fn GetClientRect(hWnd: HWND, lpRect: *mut RECT) -> BOOL;
        fn ClientToScreen(hWnd: HWND, lpPoint: *mut POINT) -> BOOL;
    }

    unsafe {
        let h = hwnd as HWND;
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let mut o = POINT { x: 0, y: 0 };
        if GetClientRect(h, &mut r) == 0 || ClientToScreen(h, &mut o) == 0 {
            return None;
        }
        let w = (r.right - r.left).max(0) as u32;
        let hgt = (r.bottom - r.top).max(0) as u32;
        if w == 0 || hgt == 0 {
            return None;
        }
        Some((o.x, o.y, w, hgt))
    }
}

fn lol_window_foreground(hwnd: isize) -> bool {
    use std::ffi::c_void;
    type HWND = *mut c_void;
    type BOOL = i32;
    extern "system" {
        fn GetForegroundWindow() -> HWND;
        fn IsIconic(hWnd: HWND) -> BOOL;
    }
    unsafe {
        GetForegroundWindow() == hwnd as HWND && IsIconic(hwnd as HWND) == 0
    }
}

struct DdaPipeline {
    ctx: ID3D11DeviceContext,
    dup: IDXGIOutputDuplication,
    staging: ID3D11Texture2D,
    out_left: i32,
    out_top: i32,
    out_w: i32,
    out_h: i32,
}

/// Builds a duplication pipeline on the adapter/output that currently holds
/// the game window. Returns None when DDA is unavailable (RDP, HDR formats,
/// driver issues) so the caller can fall back to legacy gdigrab capture.
unsafe fn dda_setup(hwnd: isize) -> Option<DdaPipeline> {
    let (cx, cy, _w, _h) = lol_client_rect(hwnd)?;

    let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
    for ai in 0..8u32 {
        let Ok(adapter) = factory.EnumAdapters1(ai) else { break };
        for oi in 0..16u32 {
            let Ok(output) = adapter.EnumOutputs(oi) else { break };
            let Ok(desc) = output.GetDesc() else { continue };
            let r = desc.DesktopCoordinates;
            if cx < r.left || cx >= r.right || cy < r.top || cy >= r.bottom {
                continue;
            }

            let mut device: Option<ID3D11Device> = None;
            let mut ctx: Option<ID3D11DeviceContext> = None;
            let mut fl = D3D_FEATURE_LEVEL_11_0;
            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1]),
                7,
                Some(&mut device),
                Some(&mut fl),
                Some(&mut ctx),
            ).ok()?;
            let device = device?;
            let ctx = ctx?;

            let dup = output.cast::<IDXGIOutput1>().ok()?.DuplicateOutput(&device).ok()?;

            // HDR outputs hand us FP16 frames we cannot cheaply convert.
            let dd = dup.GetDesc();
            if dd.ModeDesc.Format != DXGI_FORMAT_B8G8R8A8_UNORM {
                return None;
            }

            let tdesc = D3D11_TEXTURE2D_DESC {
                Width: (r.right - r.left).max(1) as u32,
                Height: (r.bottom - r.top).max(1) as u32,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
            };
            let mut staging: Option<ID3D11Texture2D> = None;
            device.CreateTexture2D(&tdesc, None, Some(&mut staging)).ok()?;
            let staging = staging?;

            return Some(DdaPipeline {
                ctx, dup, staging,
                out_left: r.left, out_top: r.top,
                out_w: r.right - r.left, out_h: r.bottom - r.top,
            });
        }
    }
    None
}

/// Cheap preflight used by start_recording to decide between the DDA
/// rawvideo pipeline and the legacy gdigrab fallback before ffmpeg spawns.
/// Returns the evened client dimensions for the rawvideo stream.
fn dda_validate(hwnd: isize) -> Option<(u32, u32)> {
    let (_x, _y, w, h) = lol_client_rect(hwnd)?;
    if unsafe { dda_setup(hwnd) }.is_some() {
        Some((w & !1, h & !1))
    } else {
        None
    }
}

/// Copies the game client rect from the mapped full-output frame into the
/// canvas. Everything outside stays zeroed (black).
unsafe fn blit_client(
    pipe: &DdaPipeline,
    mapped: &D3D11_MAPPED_SUBRESOURCE,
    rx: i32, ry: i32, rw: u32, rh: u32,
    canvas: &mut [u8],
    cw: u32,
) {
    let sx = (rx - pipe.out_left).max(0);
    let sy = (ry - pipe.out_top).max(0);
    let sw = ((rw as i32).min(pipe.out_w - sx)).max(0) as u32;
    let sh = ((rh as i32).min(pipe.out_h - sy)).max(0) as u32;
    if sw == 0 || sh == 0 {
        return;
    }
    // Crop to the canvas if the window grew beyond the initial size.
    let copy_w = sw.min(cw);
    let copy_h = sh.min((canvas.len() / (cw as usize * 4)) as u32);
    let src = mapped.pData as *const u8;
    let pitch = mapped.RowPitch as usize;
    for row in 0..copy_h as usize {
        let sp = src.add((sy as usize + row) * pitch + sx as usize * 4);
        let dp = row * cw as usize * 4;
        std::ptr::copy_nonoverlapping(sp, canvas[dp..].as_mut_ptr(), copy_w as usize * 4);
    }
}

/// Streams BGRA frames of the game client into ffmpeg's stdin as a rawvideo
/// feed at ~30fps until VIDEO_CAPTURE_STOP fires. Dropping stdin closes the
/// pipe: ffmpeg sees video EOF and finalizes the file cleanly.
///
/// The canvas retains the last known content between successful DDA frames.
/// `canvas.fill(0)` is ONLY applied when transitioning from visible→hidden
/// (show → !show). When DDA times out while the game is in the foreground
/// the previous content is rewritten as-is — correct CFR behaviour that
/// avoids turning practice-tool-like static scenes entirely black.
fn run_video_capture(mut stdin: std::process::ChildStdin, hwnd_hint: isize, cw: u32, ch: u32) {
    let mut canvas = vec![0u8; cw as usize * ch as usize * 4];
    let frame_dur = std::time::Duration::from_millis(33);
    let mut next_tick = std::time::Instant::now();
    let mut missing_since: Option<std::time::Instant> = None;
    let mut prev_show = false;

    'outer: while !VIDEO_CAPTURE_STOP.load(std::sync::atomic::Ordering::SeqCst) {
        let hwnd = if hwnd_hint != 0 && lol_window_alive(hwnd_hint) {
            hwnd_hint
        } else {
            find_lol_hwnd()
        };
        if hwnd == 0 {
            if missing_since.map(|t| t.elapsed()).unwrap_or_default()
                > std::time::Duration::from_secs(20)
            {
                break 'outer;
            }
            if missing_since.is_none() {
                missing_since = Some(std::time::Instant::now());
            }
            if prev_show {
                canvas.fill(0);
                prev_show = false;
            }
            let _ = stdin.write_all(&canvas);
            next_tick += frame_dur;
            let now = std::time::Instant::now();
            if next_tick > now { std::thread::sleep(next_tick - now); } else { next_tick = now; }
            continue;
        }
        missing_since = None;

        let pipe = match unsafe { dda_setup(hwnd) } {
            Some(p) => p,
            None => {
                std::thread::sleep(std::time::Duration::from_millis(300));
                continue;
            }
        };

        // Inner loop: reuse the duplication pipeline until it goes stale.
        loop {
            if VIDEO_CAPTURE_STOP.load(std::sync::atomic::Ordering::SeqCst) {
                break 'outer;
            }
            let client = lol_client_rect(hwnd);
            let show = client.is_some()
                && lol_window_foreground(hwnd)
                && pipe.out_w > 0;

            // Zero canvas only on the visible→hidden transition.
            if !show && prev_show {
                canvas.fill(0);
            }
            prev_show = show;

            unsafe {
                let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
                let mut resource: Option<IDXGIResource> = None;
                match pipe.dup.AcquireNextFrame(16, &mut info, &mut resource) {
                    Ok(()) => {
                        if let Ok(tex) = resource.unwrap().cast::<ID3D11Texture2D>() {
                            pipe.ctx.CopyResource(&pipe.staging, &tex);
                            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                            if pipe.ctx.Map(&pipe.staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).is_ok() {
                                if show {
                                    if let Some((rx, ry, rw, rh)) = lol_client_rect(hwnd) {
                                        canvas.fill(0);
                                        blit_client(&pipe, &mapped, rx, ry, rw, rh, &mut canvas, cw);
                                    }
                                }
                                pipe.ctx.Unmap(&pipe.staging, 0);
                            }
                        }
                        let _ = pipe.dup.ReleaseFrame();
                    }
                    Err(e) => {
                        let code = e.code();
                        use windows::Win32::Graphics::Dxgi::DXGI_ERROR_WAIT_TIMEOUT;
                        if code == DXGI_ERROR_WAIT_TIMEOUT {
                            // No new frame — keep previous canvas content.
                        } else {
                            // ACCESS_LOST or other: output changed, recreate.
                            break;
                        }
                    }
                }
                let _ = stdin.write_all(&canvas);
            }

            next_tick += frame_dur;
            let now = std::time::Instant::now();
            if next_tick > now { std::thread::sleep(next_tick - now); } else { next_tick = now; }
        }
    }
}


#[derive(Serialize)]
struct VodFile {
    path: String,
    duration: f64,
}

/// Exact duration of a finished recording via ffprobe (ships next to the
/// bundled ffmpeg). Wall-clock estimates drift by several seconds because
/// ffmpeg starts after the game-start wait and stops a few seconds late.
fn probe_media_duration(app: &tauri::AppHandle, video_path: &str) -> Option<f64> {
    let cfg = read_config(app);
    let ffmpeg = cfg.get("ffmpegPath")?.as_str()?;
    let ffprobe = std::path::Path::new(ffmpeg).parent()?.join("ffprobe.exe");
    let out = Command::new(ffprobe)
        .args([
            "-v".to_string(), "error".to_string(),
            "-show_entries".to_string(), "format=duration".to_string(),
            "-of".to_string(), "default=noprint_wrappers=1:nokey=1".to_string(),
            video_path.to_string(),
        ])
        .creation_flags(0x08000000)
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    s.parse::<f64>().ok().filter(|d| d.is_finite() && *d > 1.0)
}

#[tauri::command]
async fn start_recording(app: tauri::AppHandle) -> Result<String, String> {
    {
        let guard = FFMPEG_PROC.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("Already recording".to_string());
        }
    }
    AUDIO_CAPTURE_STOP.store(false, std::sync::atomic::Ordering::SeqCst);
    if let Ok(mut g) = LAST_GAME_MODE.lock() {
        *g = None;
    }

    let cfg = read_config(&app);
    let ffmpeg_path = cfg.get("ffmpegPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if ffmpeg_path.is_empty() {
        return Err("FFmpeg path not configured".to_string());
    }

    let recordings_folder = cfg.get("recordingsFolder")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(default_recordings_folder);
    std::fs::create_dir_all(&recordings_folder).map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = format!("recording-{}.mp4", ts);
    let output_path = std::path::Path::new(&recordings_folder).join(&filename);
    let output_str = output_path.to_string_lossy().to_string();

    // The in-game detection can fire during champ select, before the LoL
    // window exists: poll for it instead of failing permanently.
    tauri::async_runtime::spawn_blocking(|| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        let mut rect = find_lol_window_rect();
        while rect.is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_secs(2));
            rect = find_lol_window_rect();
        }
        rect
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "League of Legends window not found".to_string())?;

    // Wait for the in-game clock (00:00) before rolling: skips champ select
    // and the loading screen. Falls back to recording anyway if the Live
    // Client Data API never comes up; aborts if the window disappears.
    match tauri::async_runtime::spawn_blocking(|| wait_for_game_start(420)).await {
        Ok(GameStartWait::WindowClosed) => {
            return Err("League of Legends window closed before the game started".to_string());
        }
        _ => {}
    }

    // Capture the game client via DXGI Desktop Duplication (GPU-composited:
    // works with DirectX, no CAPTUREBLT cursor flicker, near-zero CPU, black
    // when the window is minimized or unfocused). Fall back to the legacy
    // gdigrab desktop-region capture when DDA is unavailable.
    VIDEO_CAPTURE_STOP.store(false, std::sync::atomic::Ordering::SeqCst);

    // find_lol_hwnd() may return 0 right after the game start wait (the
    // window is not yet visible during loading). Retry a few times before
    // giving up on DDA.
    let mut hwnd = find_lol_hwnd();
    for _ in 0..5u32 {
        if hwnd != 0 { break; }
        std::thread::sleep(std::time::Duration::from_secs(2));
        hwnd = find_lol_hwnd();
    }
    let video_plan = if hwnd != 0 { dda_validate(hwnd) } else { None };
    // If DDA failed but the window exists, try DDA once more with a fresh
    // handle after a short delay — the window may have just appeared.
    let video_plan = match video_plan {
        Some(_) => video_plan,
        None if hwnd == 0 => {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let h2 = find_lol_hwnd();
            if h2 != 0 { dda_validate(h2) } else { None }
        }
        None => None,
    };
    VIDEO_MODE_DDA.store(video_plan.is_some(), std::sync::atomic::Ordering::SeqCst);

    let mut ffmpeg_args = if let Some((cw, ch)) = video_plan {
        vec![
            "-f".to_string(), "rawvideo".to_string(),
            "-pixel_format".to_string(), "bgra".to_string(),
            "-video_size".to_string(), format!("{}x{}", cw, ch),
            "-framerate".to_string(), "30".to_string(),
            "-i".to_string(), "pipe:0".to_string(),
        ]
    } else {
        let (x, y, w, h) = find_lol_window_rect()
            .ok_or_else(|| "League of Legends window not found".to_string())?;
        vec![
            "-f".to_string(), "gdigrab".to_string(),
            "-framerate".to_string(), "30".to_string(),
            "-draw_mouse".to_string(), "1".to_string(),
            "-offset_x".to_string(), x.to_string(),
            "-offset_y".to_string(), y.to_string(),
            "-video_size".to_string(), format!("{}x{}", w, h),
            "-i".to_string(), "desktop".to_string(),
        ]
    };

    // Audio per user setting (default: game-only via process loopback).
    let mode = audio_mode_from_cfg(&cfg);
    let out_dev = cfg.get("audioOutputDevice")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let (audio_inputs, audio_gates) =
        tauri::async_runtime::spawn_blocking(move || setup_audio_sources(mode, out_dev))
            .await
            .map_err(|e| e.to_string())?;

    for AudioInput::Pipe(args) in &audio_inputs {
        ffmpeg_args.extend(args.iter().cloned());
    }
    let has_audio = !audio_inputs.is_empty();
    if has_audio {
        if audio_inputs.len() >= 2 {
            // Mix game + discord trees into one track (normalize=0 keeps level).
            ffmpeg_args.extend([
                "-filter_complex".to_string(),
                "[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a1];[2:a]aformat=sample_rates=48000:channel_layouts=stereo[a2];[a1][a2]amix=inputs=2:duration=longest:normalize=0[aout]".to_string(),
                "-map".to_string(), "0:v:0".to_string(),
                "-map".to_string(), "[aout]".to_string(),
            ]);
        } else {
            ffmpeg_args.extend([
                "-map".to_string(), "0:v:0".to_string(),
                "-map".to_string(), "1:a:0".to_string(),
            ]);
        }
        ffmpeg_args.extend([
            "-c:a".to_string(), "aac".to_string(),
            "-b:a".to_string(), "128k".to_string(),
            "-ar".to_string(), "44100".to_string(),
            "-ac".to_string(), "2".to_string(),
            "-shortest".to_string(),
        ]);
    }

    ffmpeg_args.extend([
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "ultrafast".to_string(),
        "-pix_fmt".to_string(), "yuv420p".to_string(),
        "-movflags".to_string(), "+faststart+frag_keyframe+empty_moov".to_string(),
        "-max_muxing_queue_size".to_string(), "4096".to_string(),
        "-y".to_string(),
        output_str.clone(),
    ]);

    // Log ffmpeg stderr to a file next to the recording so we can debug
    // silent recordings, audio failures, etc.
    let log_path = std::path::Path::new(&output_str).with_extension("ffmpeg.log");
    let ffmpeg_log_file = std::fs::File::create(&log_path)
        .map(std::process::Stdio::from)
        .unwrap_or(std::process::Stdio::null());

    let mut child = match Command::new(&ffmpeg_path)
        .args(&ffmpeg_args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(ffmpeg_log_file)
        .creation_flags(0x08000000)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            AUDIO_CAPTURE_STOP.store(true, std::sync::atomic::Ordering::SeqCst);
            for g in &audio_gates {
                g.open();
            }
            return Err(e.to_string());
        }
    };

    let stdin = child.stdin.take();

    // ffmpeg is up: let the capture threads connect their pipes and roll.
    for g in &audio_gates {
        g.open();
    }

    // In DDA mode ffmpeg's stdin IS the video feed: hand it to the capture
    // thread (stop_recording ends the recording by closing it). Legacy
    // gdigrab keeps stdin stored so stop can send 'q'.
    let mut proc_stdin = None;
    if VIDEO_MODE_DDA.load(std::sync::atomic::Ordering::SeqCst) {
        let (cw_dda, ch_dda) = video_plan.unwrap_or((0, 0));
        if let Some(si) = stdin {
            let plan_hwnd = hwnd;
            tauri::async_runtime::spawn_blocking(move || {
                run_video_capture(si, plan_hwnd, cw_dda, ch_dda)
            });
        }
    } else {
        proc_stdin = stdin;
    }

    {
        let mut guard = FFMPEG_PROC.lock().map_err(|e| e.to_string())?;
        *guard = Some(FFmpegProcess { child, stdin: proc_stdin });
    }
    {
        let mut guard = FFMPEG_OUTPUT.lock().map_err(|e| e.to_string())?;
        *guard = Some(output_str.clone());
    }

    // Instant-timeline source: poll the Live Client Data API while the
    // recording runs and dump sibling .events.json when it ends.
    start_event_capture(output_str.clone());
    // Thumbnail frame a few seconds into the recording.
    start_thumbnail_worker(output_str.clone(), ffmpeg_path.clone());

    Ok(output_str)
}

#[tauri::command]
async fn stop_recording(app: tauri::AppHandle) -> Result<Option<VodFile>, String> {
    stop_event_capture();
    // DDA mode: the capturer thread owns ffmpeg's stdin — flag it to stop
    // (~100ms) so dropping stdin delivers video EOF and ffmpeg finalizes.
    VIDEO_CAPTURE_STOP.store(true, std::sync::atomic::Ordering::SeqCst);
    let dda_mode = VIDEO_MODE_DDA.swap(false, std::sync::atomic::Ordering::SeqCst);
    let output_path = {
        let mut guard = FFMPEG_PROC.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut proc) = *guard {
            let mut gracefully_closed = false;
            if !dda_mode {
                // Legacy path: try graceful shutdown via 'q' on stdin
                if let Some(ref mut stdin) = proc.stdin {
                    let _ = stdin.write_all(b"q\n");
                    let _ = stdin.flush();
                }
            }
            // Wait for FFmpeg to finalize the file (EOF already delivered in DDA mode)
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
            while std::time::Instant::now() < deadline {
                match proc.child.try_wait() {
                    Ok(Some(_)) => { gracefully_closed = true; break; }
                    Ok(None) => { std::thread::sleep(std::time::Duration::from_millis(100)); }
                    Err(_) => break,
                }
            }
            // Force kill only if graceful shutdown failed
            if !gracefully_closed {
                let _ = proc.child.kill();
                let _ = proc.child.wait();
            }
        }
        *guard = None;
        AUDIO_CAPTURE_STOP.store(true, std::sync::atomic::Ordering::SeqCst);
        FFMPEG_OUTPUT.lock().map_err(|e| e.to_string())?.take()
    };
    // Small delay to let the file system flush
    std::thread::sleep(std::time::Duration::from_millis(200));
    // Guard: if ffmpeg produced an empty / tiny file (no frames written),
    // discard it so the frontend doesn't create a ghost VOD entry.
    if let Some(ref p) = output_path {
        match std::fs::metadata(p) {
            Ok(meta) if meta.len() < 4096 => {
                let _ = std::fs::remove_file(p);
                return Ok(None);
            }
            Err(_) => {
                return Ok(None);
            }
            _ => {}
        }
    }
    let duration = output_path
        .as_deref()
        .and_then(|p| probe_media_duration(&app, p))
        .unwrap_or(0.0);
    Ok(output_path.map(|path| VodFile { path, duration }))
}

/// Removes a VOD and all its associated files from disk (mp4, events.json,
/// thumbnail). Called from the frontend when the user deletes a VOD.
#[tauri::command]
fn delete_vod(video_path: String) -> Result<(), String> {
    let base = std::path::Path::new(&video_path);
    let _ = std::fs::remove_file(base);
    let mut ev = base.to_path_buf();
    ev.set_extension("events.json");
    let _ = std::fs::remove_file(ev);
    let mut th = base.to_path_buf();
    th.set_extension("thumb.jpg");
    let _ = std::fs::remove_file(th);
    let mut log = base.to_path_buf();
    log.set_extension("ffmpeg.log");
    let _ = std::fs::remove_file(log);
    Ok(())
}

/// Returns info about a VOD file so the frontend can decide whether to show
/// the player or the placeholder.  `ok` is false when the file is missing,
/// empty, or too small to contain valid video.
#[tauri::command]
fn verify_vod(video_path: String) -> Result<serde_json::Value, String> {
    let p = std::path::Path::new(&video_path);
    match std::fs::metadata(p) {
        Ok(meta) => {
            let size = meta.len();
            Ok(serde_json::json!({
                "exists": true,
                "size": size,
                "ok": size > 4096,
            }))
        }
        Err(_) => Ok(serde_json::json!({
            "exists": false,
            "size": 0,
            "ok": false,
        })),
    }
}

/// Cheap WinAPI check used by the frontend watchdog to detect the end of a
/// game the moment the "League of Legends (TM) Client" window disappears.
#[tauri::command]
fn is_lol_window_open() -> bool {
    find_lol_window_rect().is_some()
}

/// Returns the locally captured LCD events for a recording (instant
/// timeline), or None when the capture file does not exist.
#[tauri::command]
fn read_vod_events(video_path: String) -> Option<String> {
    let mut p = std::path::PathBuf::from(&video_path);
    p.set_extension("events.json");
    std::fs::read_to_string(&p).ok().filter(|s| !s.trim().is_empty())
}

/// Raw "gameMode\tgameType" of the last recorded game (from the LCD API).
/// Practice/custom games never appear in Riot's Match-V5 index, so the
/// frontend uses this to skip the pending-resolution flow for them.
#[tauri::command]
fn get_last_game_mode() -> Option<String> {
    LAST_GAME_MODE.lock().ok()?.clone()
}

/// Path of the extracted thumbnail for a recording, when it already exists.
#[tauri::command]
fn get_vod_thumb(video_path: String) -> Option<String> {
    let mut p = std::path::PathBuf::from(&video_path);
    p.set_extension("thumb.jpg");
    if p.is_file() {
        Some(p.to_string_lossy().to_string())
    } else {
        None
    }
}

#[tauri::command]
async fn is_recording() -> Result<bool, String> {    let mut guard = FFMPEG_PROC.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut proc) = *guard {
        match proc.child.try_wait() {
            Ok(Some(_)) => { *guard = None; Ok(false) }
            Ok(None) => Ok(true),
            Err(_) => { *guard = None; Ok(false) }
        }
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn show_overlay(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    use tauri::Manager;

    let title_text = match lang.as_str() {
        "es" => "Grabando",
        "pt" => "Gravando",
        "fr" => "Enregistrement",
        "ko" => "녹화 중",
        _ => "Recording",
    };
    let js = format!(
        "document.getElementById('title').textContent='{}'; if (window.__rhEnter) window.__rhEnter();",
        title_text
    );

    if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.set_always_on_top(true);
        if let Some((x, y, w, h)) = find_lol_window_rect() {
            let overlay_x = x + w - 360;
            let overlay_y = y + (h / 2) - 45;
            let _ = win.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: overlay_x.max(x),
                y: overlay_y.max(y),
            }));
        }
        let _ = win.show();
        let _ = win.eval(&js);
        let handle = app.clone();
        std::thread::spawn(move || {
            // Keep the card on screen for 5s, then slide it out before hiding.
            std::thread::sleep(std::time::Duration::from_secs(5));
            if let Some(w) = handle.get_webview_window("overlay") {
                let _ = w.eval("if (window.__rhExit) window.__rhExit();");
                std::thread::sleep(std::time::Duration::from_millis(750));
                if let Some(w) = handle.get_webview_window("overlay") {
                    let _ = w.hide();
                }
            }
        });
    }
    Ok(())
}

#[tauri::command]
async fn hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.hide();
    }
    Ok(())
}

const FFMPEG_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

#[tauri::command]
async fn download_and_setup_ffmpeg(app: tauri::AppHandle) -> Result<String, String> {

    #[derive(Serialize, Clone)]
    struct ProgressPayload {
        percent: f64,
        downloaded: u64,
        total: u64,
        stage: String,
    }

    let ffmpeg_dir = app.path().app_config_dir()
        .map_err(|e| e.to_string())?
        .join("ffmpeg");
    std::fs::create_dir_all(&ffmpeg_dir).map_err(|e| e.to_string())?;

    let zip_path = ffmpeg_dir.join("ffmpeg.zip");

    let client = reqwest::Client::new();
    let resp = client.get(FFMPEG_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;

    use std::io::Write;
    use futures_util::StreamExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let percent = if total > 0 { (downloaded as f64 / total as f64) * 100.0 } else { 0.0 };
        let _ = app.emit("ffmpeg-download-progress", ProgressPayload {
            percent,
            downloaded,
            total,
            stage: "downloading".to_string(),
        });
    }
    drop(file);

    let _ = app.emit("ffmpeg-download-progress", ProgressPayload {
        percent: 100.0,
        downloaded,
        total,
        stage: "extracting".to_string(),
    });

    let zip_file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(zip_file).map_err(|e| e.to_string())?;

    let ffmpeg_exe_path = ffmpeg_dir.join("ffmpeg.exe");
    let mut found_exe = false;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();

        let is_bin_exe = name.ends_with("/bin/ffmpeg.exe");
        let is_root_exe = name == "ffmpeg.exe";

        if is_bin_exe || is_root_exe {
            let mut out = std::fs::File::create(&ffmpeg_exe_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            found_exe = true;
        } else if name.ends_with("/bin/") && !name.ends_with(".exe") {
            let entry_name = entry.name().to_string();
            if entry_name.ends_with(".dll") || entry_name.contains("swresample") || entry_name.contains("swscale") || entry_name.contains("avcodec") || entry_name.contains("avformat") || entry_name.contains("avutil") || entry_name.contains("avfilter") {
                let file_name = std::path::Path::new(&entry_name).file_name().unwrap().to_string_lossy();
                let out_path = ffmpeg_dir.join(file_name.as_ref());
                let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            }
        }
    }

    drop(archive);
    let _ = std::fs::remove_file(&zip_path);

    if !found_exe {
        return Err("ffmpeg.exe not found in archive".to_string());
    }

    let path_str = ffmpeg_exe_path.to_string_lossy().to_string();
    let mut cfg = read_config(&app);
    cfg["ffmpegPath"] = serde_json::json!(path_str);
    write_config(&app, &cfg);

    let _ = app.emit("ffmpeg-download-progress", ProgressPayload {
        percent: 100.0,
        downloaded,
        total,
        stage: "done".to_string(),
    });

    Ok(path_str)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .invoke_handler(tauri::generate_handler![
            get_riot_client_session,
            open_vod_folder,
            show_in_folder,
            select_vod_folder,
            get_default_vod_folder,
            toggle_autostart,
            is_autostart_enabled,
            get_close_behavior,
            set_close_behavior,
            get_ffmpeg_path,
            set_ffmpeg_path,
            get_recordings_folder,
            set_recordings_folder,
            select_recordings_folder,
            select_ffmpeg_file,
            test_ffmpeg,
            get_auto_record,
            set_auto_record,
            get_audio_mode,
            set_audio_mode,
            list_audio_output_devices,
            get_audio_output_device,
            set_audio_output_device,
            start_recording,
            stop_recording,
            is_recording,
            is_lol_window_open,
            read_vod_events,
            get_last_game_mode,
            get_vod_thumb,
            delete_vod,
            verify_vod,
            show_overlay,
            hide_overlay,
            download_and_setup_ffmpeg,
        ]);

    builder = builder
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder};

            let window = app.get_webview_window("main").unwrap();

            {
                let mut cfg = read_config(&app.handle());
                let changed = if cfg.get("recordingsFolder").is_none() {
                    cfg["recordingsFolder"] = serde_json::json!(default_recordings_folder());
                    true
                } else {
                    false
                };
                if cfg.get("autoRecord").is_none() {
                    cfg["autoRecord"] = serde_json::json!(true);
                }
                if changed || cfg.get("autoRecord").is_none() {
                    write_config(&app.handle(), &cfg);
                }
            }

            let show_item = MenuItemBuilder::with_id("show", "Show RiftHelper").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).item(&show_item).item(&quit_item).build()?;

            let tray = app.tray_by_id("main");

            if let Some(tray) = tray {
                let _ = tray.set_menu(Some(menu));

                let window_show = window.clone();
                let _ = tray.on_menu_event(move |_app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            let _ = window_show.show();
                            let _ = window_show.set_focus();
                        }
                        "quit" => {
                            if let Ok(mut guard) = FFMPEG_PROC.lock() {
                                if let Some(ref mut proc) = *guard {
                                    if let Some(ref mut stdin) = proc.stdin {
                                        let _ = stdin.write_all(b"q\n");
                                        let _ = stdin.flush();
                                        std::thread::sleep(std::time::Duration::from_millis(500));
                                    }
                                    let _ = proc.child.kill();
                                    let _ = proc.child.wait();
                                }
                                *guard = None;
                            }
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                });

                let window_click = window.clone();
                tray.on_tray_icon_event(move |_tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = window_click.show();
                        let _ = window_click.set_focus();
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let cfg = read_config(app);
                let behavior = cfg.get("closeBehavior")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tray");
                if behavior == "tray" {
                    let _ = window.hide();
                    api.prevent_close();
                } else {
                    if let Ok(mut guard) = FFMPEG_PROC.lock() {
                        if let Some(ref mut proc) = *guard {
                            if let Some(ref mut stdin) = proc.stdin {
                                let _ = stdin.write_all(b"q\n");
                                let _ = stdin.flush();
                                std::thread::sleep(std::time::Duration::from_millis(500));
                            }
                            let _ = proc.child.kill();
                            let _ = proc.child.wait();
                        }
                        *guard = None;
                    }
                }
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
