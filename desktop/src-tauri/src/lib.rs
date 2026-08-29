use serde::Serialize;
use tauri::Manager;
use std::sync::Arc;
use std::sync::Mutex;

use std::os::windows::process::CommandExt;

/// libobs (OBS)-based game-capture recorder. Optional at build time: the
/// OBS engine is only used when it has been bootstrapped and enabled.
mod obs_recorder;

/// Highlight clip extraction (Windows Media Foundation transcode).
#[cfg(windows)]
mod clip;

/// Recording engine switcher: true once a libobs session is active.
static OBS_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Path of the ongoing OBS recording so stop can finalize and report the file.
static OBS_OUTPUT: Mutex<Option<String>> = Mutex::new(None);
/// In-game clock (seconds) at the moment the recording's first frame was
/// captured (= gameTimeOffset). Lets us translate a hotkey press during a live
/// recording into absolute seconds into the video file.
static REC_GAME_START: Mutex<Option<f64>> = Mutex::new(None);
/// Reusable HTTP client for the LCD API. Created once, shared across all calls
/// to `query_current_game_time()` and `lcd_get_json()` to avoid allocating a
/// new TLS context + connection pool on every invocation (~100+ times per game
/// in the thumbnail worker).
static LCD_HTTP: std::sync::OnceLock<reqwest::blocking::Client> = std::sync::OnceLock::new();
fn lcd_http() -> &'static reqwest::blocking::Client {
    LCD_HTTP.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .expect("failed to build LCD HTTP client")
    })
}
/// The clip duration (seconds) requested by the user (10/15/30/45/60). Set on
/// start so the hotkey worker uses the current configured value immediately.
static REC_CLIP_DURATION: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(30);
/// Current clip hotkey name (e.g. "F9" or "Ctrl+Shift+F5"). Read by the long
/// lived hotkey worker; changed by `set_clip_hotkey`.
static CLIP_HOTKEY_NAME: Mutex<Option<String>> = Mutex::new(None);

/// A clip of the live recording requested by the hotkey, expressed as absolute
/// video seconds [start_abs, end_abs]. It cannot be cut while the MP4 is still
/// being written (the moov atom lands at finalize), so it's queued and realized
/// right after `stop_recording()` finalizes the file.
struct PendingClip {
    start_abs: f64,
    end_abs: f64,
    /// Wall-clock time of the request, used for ordering + clip metadata.
    req_at: u64,
}
static PENDING_CLIPS: Mutex<Vec<PendingClip>> = Mutex::new(Vec::new());

/// A realized clip returned from `stop_recording`: an absolute path to the
/// freshly cut mp4 plus its thumbnail jpg.
#[derive(Serialize)]
struct RealizedClip {
    path: String,
    thumb: String,
    start_abs: f64,
    end_abs: f64,
}

/// Append a line to the audio debug log at %APPDATA%\com.rifthelper.desktop\rift-helper-audio.log
/// so we can diagnose audio capture failures that `eprintln!` can't show (GUI app has no console).
fn audio_log(msg: &str) {
    eprintln!("[RiftHelper] {msg}");
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let path = std::path::PathBuf::from(appdata)
            .join("com.rifthelper.desktop")
            .join("rift-helper-audio.log");
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path));
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let _ = writeln!(f, "[{ts}] {msg}");
        }
    }
}

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

fn lcd_client() -> &'static reqwest::blocking::Client {
    lcd_http()
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

fn start_event_capture(events_path: String) {
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let handle_stop = Arc::clone(&stop);
    let builder = std::thread::Builder::new().name("lcd-events".into());
    let spawned = builder.spawn(move || run_event_capture(events_path, handle_stop));
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

/* Generates the VOD thumbnail by grabbing a live frame of the game window
   once the in-game clock reaches ~60s (the recording starts at that point,
   and OBS is capturing whatever is on screen). No ffmpeg involved: we BitBlt
   the game window's DC and encode the pixels to JPEG with the `image` crate.
   The recording session is long-lived (10-40+ min), so we keep polling until
   the in-game clock hits ~60s and take a shot. */
fn start_thumbnail_worker(thumb_path: String) {
    let spawned = std::thread::Builder::new().name("vod-thumb".into()).spawn(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(50 * 60);
        while std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if std::path::Path::new(&thumb_path).exists() {
                return;
            }
            let gt = query_current_game_time().unwrap_or(0.0);
            if gt >= 55.0 && gt <= 85.0 {
                // Try a few times to catch a clean frame.
                for _ in 0..5 {
                    if capture_window_to_jpeg(&thumb_path) {
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(300));
                }
                return;
            }
        }
    });
    if let Ok(handle) = spawned {
        std::mem::forget(handle);
    }
}

/* BitBlt's the LoL game window into a JPEG thumbnail. Top-down BGRA pixels are
   captured via GetDIBits and encoded with the `image` crate. Returns true on
   success. The window must be visible (it is, while OBS records it). */
fn capture_window_to_jpeg(path: &str) -> bool {
    let hwnd = find_lol_hwnd();
    if hwnd == 0 {
        return false;
    }
    let Some((_x, _y, w, h)) = lol_client_rect(hwnd) else {
        return false;
    };
    if w == 0 || h == 0 || w > 8192 || h > 8192 {
        return false;
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct BITMAPINFOHEADER {
        biSize: u32,
        biWidth: i32,
        biHeight: i32,
        biPlanes: u16,
        biBitCount: u16,
        biCompression: u32,
        biSizeImage: u32,
        biXPelsPerMeter: i32,
        biYPelsPerMeter: i32,
        biClrUsed: u32,
        biClrImportant: u32,
    }
    #[repr(C)]
    #[allow(non_snake_case)]
    struct BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER,
        bmiColors: [u32; 0],
    }

    unsafe {
        use std::ffi::c_void;
        type HWND = *mut c_void;
        type HDC = *mut c_void;
        type HBITMAP = *mut c_void;
        extern "system" {
            fn GetDC(hWnd: HWND) -> HDC;
            fn ReleaseDC(hWnd: HWND, hDC: HDC) -> i32;
            fn CreateCompatibleDC(hDC: HDC) -> HDC;
            fn CreateCompatibleBitmap(hDC: HDC, w: i32, h: i32) -> HBITMAP;
            fn SelectObject(hDC: HDC, h: *mut c_void) -> *mut c_void;
            fn BitBlt(
                hdcDest: HDC,
                x: i32,
                y: i32,
                w: i32,
                h: i32,
                hdcSrc: HDC,
                x1: i32,
                y1: i32,
                rop: u32,
            ) -> i32;
            fn GetDIBits(
                hdc: HDC,
                hbm: HBITMAP,
                start: u32,
                lines: u32,
                lpvBits: *mut c_void,
                lpbi: *mut BITMAPINFO,
                usage: u32,
            ) -> i32;
            fn DeleteObject(h: *mut c_void) -> i32;
            fn DeleteDC(hdc: HDC) -> i32;
        }
        const SRCCOPY: u32 = 0x00CC0020;
        const BI_RGB: u32 = 0;
        const DIB_RGB_COLORS: u32 = 0;

        let hw = hwnd as HWND;
        let wdc = GetDC(hw);
        if wdc.is_null() {
            return false;
        }
        let mem = CreateCompatibleDC(wdc);
        let bmp = CreateCompatibleBitmap(wdc, w as i32, h as i32);
        if mem.is_null() || bmp.is_null() {
            let _ = ReleaseDC(hw, wdc);
            if !mem.is_null() {
                let _ = DeleteDC(mem);
            }
            if !bmp.is_null() {
                let _ = DeleteObject(bmp as *mut c_void);
            }
            return false;
        }
        let _old = SelectObject(mem, bmp as *mut c_void);
        let blt_ok = BitBlt(mem, 0, 0, w as i32, h as i32, wdc, 0, 0, SRCCOPY);

        let real_stride = (w as usize) * 4;
        let mut buf = vec![0u8; real_stride * (h as usize)];
        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w as i32,
                biHeight: -(h as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: (real_stride * h as usize) as u32,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [],
        };
        let got = GetDIBits(
            mem,
            bmp,
            0,
            h,
            buf.as_mut_ptr() as *mut c_void,
            &mut bi as *mut BITMAPINFO,
            DIB_RGB_COLORS,
        );

        let _ = ReleaseDC(hw, wdc);
        let _ = SelectObject(mem, _old);
        let _ = DeleteObject(bmp as *mut c_void);
        let _ = DeleteDC(mem);

        if got <= 0 || blt_ok == 0 {
            return false;
        }

        // BGRA -> RGB, then encode to JPEG.
        let n = (w as usize) * (h as usize);
        let mut rgb = vec![0u8; n * 3];
        let mut si = 0usize;
        let mut di = 0usize;
        for _ in 0..n {
            rgb[di] = buf[si + 2];
            rgb[di + 1] = buf[si + 1];
            rgb[di + 2] = buf[si];
            si += 4;
            di += 3;
        }
        let Some(img) = image::RgbImage::from_raw(w, h, rgb) else {
            return false;
        };
        img.save(path).is_ok()
    }
}

fn run_event_capture(events_path: String, stop: Arc<std::sync::atomic::AtomicBool>) {
    let client = lcd_client();

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

    let events_file = std::path::PathBuf::from(&events_path);
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
                    let w = rect.right - rect.left;
                    let h = rect.bottom - rect.top;
                    if w >= 16 && h >= 16 {
                        let slot = &*(lparam as *const Mutex<Option<(i32, i32, i32, i32)>>);
                        if let Ok(mut guard) = slot.lock() {
                            *guard = Some((rect.left, rect.top, w, h));
                        }
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
async fn get_start_minimized(app: tauri::AppHandle) -> Result<bool, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("startMinimized").and_then(|v| v.as_bool()).unwrap_or(false))
}

#[tauri::command]
async fn set_start_minimized(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg["startMinimized"] = serde_json::json!(enabled);
    write_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
async fn get_focus_after_game(app: tauri::AppHandle) -> Result<bool, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("focusAfterGame").and_then(|v| v.as_bool()).unwrap_or(false))
}

#[tauri::command]
async fn set_focus_after_game(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg["focusAfterGame"] = serde_json::json!(enabled);
    write_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
async fn get_clip_duration(app: tauri::AppHandle) -> Result<i64, String> {
    let cfg = read_config(&app);
    let d = cfg.get("clipDuration").and_then(|v| v.as_i64()).unwrap_or(30);
    Ok(normalize_clip_duration(d))
}

#[tauri::command]
async fn set_clip_duration(app: tauri::AppHandle, seconds: i64) -> Result<(), String> {
    let d = normalize_clip_duration(seconds);
    let mut cfg = read_config(&app);
    cfg["clipDuration"] = serde_json::json!(d);
    write_config(&app, &cfg);
    REC_CLIP_DURATION.store(d, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn get_clip_hotkey(app: tauri::AppHandle) -> Result<String, String> {
    let cfg = read_config(&app);
    let hk = cfg.get("clipHotkey").and_then(|v| v.as_str()).unwrap_or("F9").to_string();
    Ok(hk)
}

#[tauri::command]
async fn set_clip_hotkey(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg["clipHotkey"] = serde_json::json!(key);
    write_config(&app, &cfg);
    // Re-register the global hotkey with the new key.
    spawn_hotkey_worker();
    Ok(())
}

/// Restrict the clip duration to the supported set {10,15,30,45,60}.
fn normalize_clip_duration(d: i64) -> i64 {
    match d {
        10 | 15 | 45 | 60 => d,
        _ => 30,
    }
}

/// Bring the main RiftHelper window to the foreground. Used for the
/// "focus after game" setting so the app appears when a match ends.
#[tauri::command]
async fn focus_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(())
}

/* ── Clip hotkey (global, via RegisterHotKey) ─────────────────────────
   A single long-lived thread owns the registration so it can be re-armed
   cheaply when the user changes the key. It polls for WM_HOTKEY messages on
   the thread queue (hwnd = NULL), so the hotkey fires even while the game or
   another app has focus. The queue is realized once the MP4 is finalized. */

/// Queue a clip of the *last configured seconds* of the live recording,
/// ending at the moment the hotkey was pressed. Returns Ok(true) if a clip was
/// queued, Ok(false) if nothing is recording.
fn queue_clip_now() -> Result<bool, String> {
    if !OBS_ACTIVE.load(std::sync::atomic::Ordering::SeqCst) {
        return Ok(false);
    }
    let end_abs = match *REC_GAME_START.lock().map_err(|e| e.to_string())? {
        Some(start) => query_current_game_time().map_or(0.0, |gt| (gt - start).max(0.0)),
        None => 0.0,
    };
    let duration = REC_CLIP_DURATION.load(std::sync::atomic::Ordering::SeqCst).max(1) as f64;
    let start_abs = (end_abs - duration).max(0.0);
    let req_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    PENDING_CLIPS
        .lock()
        .map_err(|e| e.to_string())?
        .push(PendingClip { start_abs, end_abs, req_at });
    Ok(true)
}

/// Cut every queued clip from the just-finalized recording into
/// `<recordings>/clips/` and build each one's thumbnail (at second 5 of the
/// clip, i.e. clip_start + 5s). Returns the realized clips for the frontend.
fn realize_pending_clips(video_path: &str, recordings: &str) -> Vec<RealizedClip> {
    #[cfg(windows)]
    {
        if !std::path::Path::new(video_path).exists() {
            PENDING_CLIPS.lock().map(|mut v| v.clear()).ok();
            return Vec::new();
        }
        let clips_dir = std::path::Path::new(recordings).join("clips");
        std::fs::create_dir_all(&clips_dir).ok();
        let thumbs_dir = clips_dir.join("thumbnails");
        std::fs::create_dir_all(&thumbs_dir).ok();

        let src_stem = std::path::Path::new(video_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "recording".to_string());

        let queued: Vec<PendingClip> = PENDING_CLIPS.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default();
        let mut realized = Vec::new();
        for pc in queued {
            if pc.end_abs - pc.start_abs < 0.2 {
                continue; // nothing but a sliver to save
            }
            let stamp = pc.req_at;
            let clip_path = clips_dir.join(format!("{src_stem}_clip_{stamp}.mp4"));
            let clip_str = clip_path.to_string_lossy().to_string();
            if clip::cut_highlight(video_path, &clip_str, pc.start_abs, pc.end_abs).is_err() {
                continue;
            }
            let thumb_dir = thumbs_dir.join(format!("{src_stem}_clip_{stamp}.jpg"));
            let thumb_str = thumb_dir.to_string_lossy().to_string();
            // Thumbnail around the 2-minute mark of the clip; if the clip is
            // shorter, grab a frame near the end instead (never at the very
            // start, which can be a black/fade frame).
            let clip_len = pc.end_abs - pc.start_abs;
            let at_sec = if clip_len >= 125.0 { 120.0 } else { (clip_len - 1.0).max(0.5) };
            clip::extract_thumbnail(&clip_str, &thumb_str, at_sec)
                .map(|_| ())
                .unwrap_or_else(|_| { let _ = std::fs::remove_file(&thumb_str); });
            realized.push(RealizedClip {
                path: clip_str,
                thumb: if std::path::Path::new(&thumb_str).exists() { thumb_str } else { String::new() },
                start_abs: pc.start_abs,
                end_abs: pc.end_abs,
            });
        }
        realized
    }
    #[cfg(not(windows))]
    {
        let _ = (video_path, recordings);
        PENDING_CLIPS.lock().map(|mut v| v.clear()).ok();
        Vec::new()
    }
}

/* --- Global-hotkey message worker. Runs for the lifetime of the app. --- */
fn spawn_hotkey_worker() {
    #[cfg(windows)]
    {
        let spawned = std::thread::Builder::new().name("clip-hotkey".into()).spawn(run_hotkey_worker);
        if let Ok(h) = spawned {
            std::mem::forget(h);
        }
    }
    #[cfg(not(windows))]
    {
        let _ = ();
    }
}

#[cfg(windows)]
fn run_hotkey_worker() {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE, WM_HOTKEY,
    };

    const MY_HOTKEY_ID: i32 = 0x5254;

    let mut current: Option<(u32, u32)> = None;
    loop {
        // Re-register if the key changed.
        let desired = CLIP_HOTKEY_NAME
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .and_then(|name| parse_hotkey(&name));
        if desired != current {
            if current.is_some() {
                unsafe {
                    let _ = UnregisterHotKey(HWND::default(), MY_HOTKEY_ID);
                }
            }
            if let Some((vk, mods)) = desired {
                unsafe {
                    if RegisterHotKey(HWND::default(), MY_HOTKEY_ID, HOT_KEY_MODIFIERS(mods), vk).is_err() {
                        audio_log(&format!("clip hotkey register failed (vk={vk}, mods={mods})"));
                    }
                }
            }
            current = desired;
        }

        // Drain any queued messages (hwnd = NULL retrieves the thread queue).
        let mut msg: MSG = MSG::default();
        while unsafe { PeekMessageW(&mut msg, HWND::default(), 0, 0, PM_REMOVE).as_bool() } {
            if msg.message == WM_HOTKEY && (msg.wParam.0 as i32) == MY_HOTKEY_ID {
                let _ = queue_clip_now();
            }
            unsafe {
                let _ = TranslateMessage(&msg);
                let _ = DispatchMessageW(&msg);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
}

/// Parse a hotkey spec like "F9", "Ctrl+Shift+F5", "Alt+F12" into
/// (virtual-key, modifier-bits). Modifier bits match Win32 MOD_* values.
fn parse_hotkey(name: &str) -> Option<(u32, u32)> {
    const MOD_ALT: u32 = 0x0001;
    const MOD_CONTROL: u32 = 0x0002;
    const MOD_SHIFT: u32 = 0x0004;
    const MOD_WIN: u32 = 0x0008;

    let mut mods = 0u32;
    let mut rest = name.to_uppercase();
    let mut changed = true;
    while changed {
        changed = false;
        for (prefix, mask) in [
            ("CTRL+", MOD_CONTROL),
            ("ALT+", MOD_ALT),
            ("SHIFT+", MOD_SHIFT),
            ("WIN+", MOD_WIN),
        ] {
            if rest.starts_with(prefix) {
                mods |= mask;
                rest = rest[prefix.len()..].trim().to_string();
                changed = true;
                break;
            }
        }
    }

    let vk = if let Some(n) = rest.strip_prefix('F').and_then(|s| s.parse::<u32>().ok()) {
        if (1..=24).contains(&n) { 0x6F + n } else { return None }
    } else {
        match rest.as_str() {
            "DELETE" => 0x2E,
            "INSERT" => 0x2D,
            "HOME" => 0x24,
            "END" => 0x23,
            "PGUP" => 0x21,
            "PGDN" => 0x22,
            _ => return None,
        }
    };
    Some((vk, mods))
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

/* Persist a highlight: extract the [start, end] window of the source VOD video
   into a dedicated `highlights/` folder as a small, standalone clip. Returns the
   new (absolute) clip path, or NULL if extraction failed. */
#[tauri::command]
async fn export_highlight_copy(
    app: tauri::AppHandle,
    video_path: String,
    start_sec: f64,
    end_sec: f64,
) -> Result<Option<String>, String> {
    let cfg = read_config(&app);
    let recordings = cfg
        .get("recordingsFolder")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(default_recordings_folder);
    let hl_dir = std::path::Path::new(&recordings).join("highlights");
    std::fs::create_dir_all(&hl_dir).map_err(|e| format!("create_dir_all: {e}"))?;

    let src = std::path::Path::new(&video_path);
    if !src.exists() {
        return Ok(None);
    }
    let file_stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "highlight".to_string());
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = hl_dir.join(format!("{file_stem}_hl_{stamp}.mp4"));
    let dest_str = dest.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        if clip::cut_highlight(&video_path, &dest_str, start_sec, end_sec).is_ok() {
            return Ok(Some(dest_str));
        }
        // fall back to streaming copy if transcode fails
        if std::fs::copy(src, &dest).is_ok() {
            return Ok(Some(dest_str));
        }
        return Ok(None);
    }
    #[cfg(not(windows))]
    {
        let _ = start_sec;
        let _ = end_sec;
        if std::fs::copy(src, &dest).is_ok() {
            return Ok(Some(dest_str));
        }
        return Ok(None);
    }
}

#[tauri::command]
async fn create_manual_clip(
    app: tauri::AppHandle,
    video_path: String,
    start_sec: f64,
    end_sec: f64,
    name: String,
) -> Result<Option<serde_json::Value>, String> {
    let cfg = read_config(&app);
    let recordings = cfg
        .get("recordingsFolder")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(default_recordings_folder);
    let clips_dir = std::path::Path::new(&recordings).join("clips");
    let thumbs_dir = clips_dir.join("thumbnails");
    std::fs::create_dir_all(&clips_dir).map_err(|e| format!("create_dir_all: {e}"))?;
    std::fs::create_dir_all(&thumbs_dir).map_err(|e| format!("create_dir_all: {e}"))?;

    let src = std::path::Path::new(&video_path);
    if !src.exists() {
        return Ok(None);
    }
    let safe_name: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '_' })
        .collect::<String>()
        .trim()
        .replace(' ', "_");
    let safe_name = if safe_name.is_empty() { "clip".to_string() } else { safe_name };
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let clip_path = clips_dir.join(format!("{safe_name}_{stamp}.mp4"));
    let clip_str = clip_path.to_string_lossy().to_string();
    let thumb_path = thumbs_dir.join(format!("{safe_name}_{stamp}.jpg"));
    let thumb_str = thumb_path.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        if clip::cut_highlight(&video_path, &clip_str, start_sec, end_sec).is_err() {
            if std::fs::copy(src, &clip_path).is_err() {
                return Ok(None);
            }
        }
        // Thumbnail at the very first second of the clip (second 1).
        clip::extract_thumbnail(&clip_str, &thumb_str, 1.0).ok();
        let thumb = if thumb_path.exists() { thumb_str.clone() } else { String::new() };
        return Ok(Some(serde_json::json!({ "path": clip_str, "thumb": thumb })));
    }
    #[cfg(not(windows))]
    {
        let _ = (start_sec, end_sec, &thumb_str);
        if std::fs::copy(src, &clip_path).is_err() {
            return Ok(None);
        }
        Ok(Some(serde_json::json!({ "path": clip_str, "thumb": "" })))
    }
}

#[tauri::command]
async fn set_recordings_folder(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let mut cfg = read_config(&app);    cfg["recordingsFolder"] = serde_json::json!(folder);
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
    // Auto-record now implies OBS capture. The flag stays on even when auto
    // record is disabled afterwards, so the app remains OBS-ready / elevated.
    if enabled {
        cfg["useObsCapture"] = serde_json::json!(true);
    }
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
async fn get_mute_mic(app: tauri::AppHandle) -> Result<bool, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("muteMic")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

#[tauri::command]
async fn set_mute_mic(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg["muteMic"] = serde_json::json!(enabled);
    write_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
async fn get_use_obs_capture(app: tauri::AppHandle) -> Result<bool, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("useObsCapture")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

#[tauri::command]
async fn set_use_obs_capture(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg["useObsCapture"] = serde_json::json!(enabled);
    write_config(&app, &cfg);
    Ok(())
}

/// Setup / first-run flow for the OBS capture engine, called from the
/// auto-record confirmation popup. Ensures the binaries are installed and the
/// process is running elevated (UAC once). If it must relaunch (new libobs
/// dll, or not elevated), the process exits and reopens on its own.
#[tauri::command]
async fn setup_obs_capture(app: tauri::AppHandle) -> Result<bool, String> {
    {
        let mut cfg = read_config(&app);
        cfg["useObsCapture"] = serde_json::json!(true);
        write_config(&app, &cfg);
    }
    ensure_obs_runtime();
    Ok(true)
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

#[tauri::command]
async fn get_recording_fps(app: tauri::AppHandle) -> Result<String, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("recordingFps")
        .and_then(|v| v.as_str())
        .unwrap_or("30")
        .to_string())
}

#[tauri::command]
async fn set_recording_fps(app: tauri::AppHandle, fps: String) -> Result<(), String> {
    let normalized = match fps.as_str() {
        "60" => "60",
        "120" => "120",
        _ => "30",
    };
    let mut cfg = read_config(&app);
    cfg["recordingFps"] = serde_json::json!(normalized);
    write_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
async fn get_recording_quality(app: tauri::AppHandle) -> Result<String, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("recordingQuality")
        .and_then(|v| v.as_str())
        .unwrap_or("720p")
        .to_string())
}

#[tauri::command]
async fn set_recording_quality(app: tauri::AppHandle, quality: String) -> Result<(), String> {
    let normalized = match quality.as_str() {
        "1080p" => "1080p",
        "1440p" => "1440p",
        "480p" => "480p",
        "4k" => "4k",
        _ => "720p",
    };
    let mut cfg = read_config(&app);
    cfg["recordingQuality"] = serde_json::json!(normalized);
    write_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
async fn get_disk_usage(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let cfg = read_config(&app);
    let folder = cfg.get("recordingsFolder")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(default_recordings_folder);
    // Walk up from the recordings folder until we find an existing root path.
    let root = std::path::Path::new(&folder);
    let root = if root.exists() {
        root
    } else {
        // Walk parents to find the first existing ancestor.
        root.parent().unwrap_or(root)
    };
    // On Windows, GetDiskFreeSpaceExW needs the root of the drive (e.g. "C:\").
    let root_str = root.to_string_lossy().to_string();
    let drive_root = if root_str.len() >= 2 && root_str.as_bytes()[1] == b':' {
        format!("{}\\", &root_str[..2])
    } else {
        root_str.clone()
    };
    unsafe {
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        use windows::core::PCWSTR;
        let wide: Vec<u16> = drive_root.encode_utf16().chain(std::iter::once(0)).collect();
        let mut free_bytes_avail: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut _total_free: u64 = 0;
        let ok = GetDiskFreeSpaceExW(
            PCWSTR(wide.as_ptr()),
            Some(&mut free_bytes_avail as *mut u64),
            Some(&mut total_bytes as *mut u64),
            Some(&mut _total_free as *mut u64),
        );
        if ok.is_ok() && total_bytes > 0 {
            let used = total_bytes - free_bytes_avail;
            return Ok(serde_json::json!({
                "totalBytes": total_bytes,
                "usedBytes": used,
                "freeBytes": free_bytes_avail,
                "drive": drive_root,
            }));
        }
    }
    Err("Failed to get disk usage".to_string())
}

/// Outcome of waiting for the in-game clock.
enum GameStartWait {
    Started(f64), // gameTime in seconds when recording starts
    Timeout,
    WindowClosed,
}

/// Polls Riot's Live Client Data API (port 2999, served by the game client)
/// until the in-game session is reachable AND the loading screen has ended.
/// Port 2999 only answers once the game process is up. During the loading
/// screen, gameTime is frozen near 0. We wait for the clock to advance past
/// a threshold (LOADING_GRACE_SECS) to ensure the game has actually started.
/// If the window disappears the game was cancelled/dodged.
fn wait_for_game_start(max_secs: u64) -> GameStartWait {
    // The in-game clock (gameTime) only starts counting once the match begins,
    // after the loading screen ends — it stays near 0 while loading. We want
    // the recording to start at the exact in-game second 8 (00:08). To do that
    // we confirm the clock is actually running (loading is over) and then fire
    // the moment it reaches TARGET_START, polling finely so we land as close to
    // 8.0s as possible and never a second before (7.x). OBS is already prepared
    // (warm) by now, so `begin()` captures within a frame or two of this.
    const TARGET_START: f64 = 8.0;

    let client = match reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
    {
        Ok(c) => c,
        Err(_) => return GameStartWait::Timeout,
    };
    let url = "https://127.0.0.1:2999/liveclientdata/gamestats";
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(max_secs);
    // True when we observed the clock below the target (the normal ranked flow:
    // we connect during champ select / loading, so we see it start from ~0).
    // False means we only started seeing it after 00:10 already (a late join
    // that cannot be rewound).
    let mut saw_below = false;
    let mut missing = 0u32;
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
                missing = 0;
                // Mid-game join (reconnect): start immediately, can't rewind.
                if t >= 90.0 {
                    return GameStartWait::Started(t);
                }
                if !saw_below && t < TARGET_START {
                    saw_below = true;
                }
                // Normal ranked path: we saw the clock below 00:10 and it has now
                // crossed it — start at the exact in-game second 10.
                // Late-join path (never saw it below target): start now at t.
                if t >= TARGET_START {
                    let start = if saw_below { TARGET_START } else { t };
                    audio_log(&format!(
                        "wait_for_game_start: starting at in-game {start:.1}s (saw_below={saw_below})"
                    ));
                    return GameStartWait::Started(start);
                }
            }
            None => {
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
        std::thread::sleep(std::time::Duration::from_millis(120));
    }
    GameStartWait::Timeout
}

/// Single-shot query of the Live Client Data API gameTime. Used to resync
/// the video-to-game offset right before the first frame is captured,
/// closing the setup gap between wait_for_game_start() returning and the
/// actual recording start.
fn query_current_game_time() -> Option<f64> {
    let data: serde_json::Value = lcd_http()
        .get("https://127.0.0.1:2999/liveclientdata/gamestats")
        .timeout(std::time::Duration::from_millis(800))
        .send()
        .ok()?
        .json()
        .ok()?;
    data.get("gameTime").and_then(|t| t.as_f64())
}

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
/// Layout must match PROPVARIANT on x64: vt(2) + wReserved(6) + union(16).
/// For VT_LPWSTR the PWSTR pointer sits at the start of the union (offset 8).
#[repr(C)]
struct RawLpwstrVariant {
    vt: u16,
    reserved: [u16; 3],
    pwsz: *mut u16, // offset 8 — matches the PROPVARIANT union start
}
const VT_LPWSTR_U16: u16 = 31;

fn propvariant_to_string(pv: &windows::core::PROPVARIANT) -> Option<String> {
    unsafe {
        let mut raw = RawLpwstrVariant {
            vt: 0,
            reserved: [0u16; 3],
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

/// Given a video path like `...\RiftHelper\vods\recording-XXX.mp4`, return
/// the associated file path in the correct subdirectory.
fn vod_sibling(video_path: &str, subdir: &str, ext: &str) -> std::path::PathBuf {
    let p = std::path::Path::new(video_path);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let parent = p.parent().and_then(|pp| pp.parent()).unwrap_or(p);
    parent.join(subdir).join(format!("{}.{}", stem, ext))
}

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

#[derive(Serialize)]
struct VodFile {
    path: String,
    duration: f64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    clips: Vec<RealizedClip>,
}

/// After OBS graphics-hook injection starts, a true-exclusive-fullscreen game
/// can be kicked out of exclusive mode (seen as a minimize). Watch the game
/// window for the first seconds of a recording and RESTORE it only if it is
/// actually minimized. We deliberately do NOT drag an exclusive-fullscreen
/// window back to the foreground on a timer — repeatedly pulling it up while
/// the game-capture hook pushes it back down is exactly what produces the
/// repeated black-flash / re-minimize loop.
fn start_focus_watchdog(hwnd: isize) {
    if hwnd == 0 {
        return;
    }
    std::thread::spawn(move || {
        use std::ffi::c_void;
        type HWND = *mut c_void;
        type BOOL = i32;
        extern "system" {
            fn IsIconic(hWnd: HWND) -> BOOL;
            fn ShowWindow(hWnd: HWND, nCmdShow: i32) -> BOOL;
            fn SetForegroundWindow(hWnd: HWND) -> BOOL;
            fn AttachThreadInput(idAttach: u32, idAttachTo: u32, fAttach: i32) -> BOOL;
            fn GetCurrentThreadId() -> u32;
            fn GetWindowThreadProcessId(hWnd: HWND, lpdwProcessId: *mut u32) -> u32;
        }
        const SW_RESTORE: i32 = 9;
        const SW_SHOW: i32 = 5;
        unsafe fn attach(gtid: u32) {
            let _ = AttachThreadInput(GetCurrentThreadId(), gtid, 1);
        }
        unsafe fn detach(gtid: u32) {
            let _ = AttachThreadInput(GetCurrentThreadId(), gtid, 0);
        }
        for _ in 0..60 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            unsafe {
                let h = hwnd as HWND;
                if IsIconic(h) != 0 {
                    // The game is genuinely minimized: restore it once and stop
                    // probing until the next poll — do not force foreground on
                    // a timer, which would restart the exclusive-mode drop.
                    let gtid = GetWindowThreadProcessId(h, std::ptr::null_mut());
                    attach(gtid);
                    let _ = ShowWindow(h, SW_RESTORE);
                    let _ = ShowWindow(h, SW_SHOW);
                    let _ = SetForegroundWindow(h);
                    detach(gtid);
                    audio_log("focus watchdog: game window minimized - restoring");
                }
            }
        }
    });
}

/// Paths derived from the recordings folder for one session. Shared by the OBS
/// prepare step and the timeline/thumbnail workers started after `begin`.
struct ObsPaths {
    output: String,
    thumb: String,
    events: String,
}

/// Build the OBS session config + derived output paths from user settings.
fn build_obs_config(
    cfg: &serde_json::Value,
) -> Result<(obs_recorder::ObsRecordingConfig, ObsPaths), String> {
    let recordings_folder = cfg
        .get("recordingsFolder")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(default_recordings_folder);
    std::fs::create_dir_all(&recordings_folder).map_err(|e| e.to_string())?;

    let base = std::path::Path::new(&recordings_folder);
    let vods_dir = base.join("vods");
    let thumbs_dir = base.join("thumbnails");
    let logs_dir = base.join("logs");
    let timeline_dir = base.join("timeline");
    std::fs::create_dir_all(&vods_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&timeline_dir).map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let stem = format!("recording-{}", ts);
    let output_str = vods_dir
        .join(format!("{}.mp4", stem))
        .to_string_lossy()
        .to_string();
    let thumb_str = thumbs_dir
        .join(format!("{}.thumb.jpg", stem))
        .to_string_lossy()
        .to_string();
    let events_str = timeline_dir
        .join(format!("{}.events.json", stem))
        .to_string_lossy()
        .to_string();

    // Recording quality and FPS from user settings.
    let rec_fps: u32 = cfg
        .get("recordingFps")
        .and_then(|v| v.as_str())
        .unwrap_or("30")
        .parse()
        .unwrap_or(30);
    let rec_quality = cfg
        .get("recordingQuality")
        .and_then(|v| v.as_str())
        .unwrap_or("720p")
        .to_string();
    let rec_height: u32 = match rec_quality.as_str() {
        "480p" => 480,
        "720p" => 720,
        "1080p" => 1080,
        _ => 0, // 1440p / 4k: native resolution
    };

    let audio_mode = match audio_mode_from_cfg(cfg) {
        AudioMode::System => obs_recorder::ObsAudioMode::System,
        AudioMode::GameDiscord => obs_recorder::ObsAudioMode::GameDiscord,
        AudioMode::Game => obs_recorder::ObsAudioMode::Game,
    };
    let audio_device = cfg
        .get("audioOutputDevice")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let config = obs_recorder::ObsRecordingConfig {
        output_path: output_str.clone(),
        fps: rec_fps,
        height: rec_height,
        video_bitrate: match rec_height {
            1080 => 12000,
            720 => 6500,
            480 => 3500,
            _ => 16000, // native (1440p/4k)
        },
        audio_bitrate: 192,
        audio_mode,
        audio_output_device: audio_device,
        capture_window_id: None,
    };
    Ok((
        config,
        ObsPaths {
            output: output_str,
            thumb: thumb_str,
            events: events_str,
        },
    ))
}

#[tauri::command]
async fn start_recording(app: tauri::AppHandle) -> Result<String, String> {
    if OBS_ACTIVE.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Already recording".to_string());
    }
    if let Ok(mut g) = LAST_GAME_MODE.lock() {
        *g = None;
    }

    let cfg = read_config(&app);

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

    // Build the OBS session config + derived paths once (used by prepare and
    // by the workers started right after `begin`).
    let (obs_config, paths) = build_obs_config(&cfg)?;

    // Start the focus watchdog BEFORE the OBS graphics-hook injection runs.
    // Injecting the hook / grabbing the shared D3D11 texture can kick a
    // true-exclusive-fullscreen game out of exclusive mode (seen as a
    // minimize), so we watch and yank the game back while OBS sets up and
    // for the first few seconds of the recording.
    start_focus_watchdog(find_lol_hwnd());

    // Phase 1 — PREPARE: warm up the OBS engine (context/scene/sources/output)
    // during the loading screen, while the in-game clock is still near 0, so
    // the ≈1–2s OBS/hook setup cost does NOT count against the game clock.
    tauri::async_runtime::spawn_blocking(move || obs_recorder::prepare(obs_config))
        .await
        .map_err(|e| e.to_string())??;

    // Wait for the in-game clock to reach ~00:08 (the loading screen is over
    // by then), then fire `begin()`. Falls back to recording anyway if the
    // Live Client Data API never comes up; aborts if the window disappears.
    let detected_start = match tauri::async_runtime::spawn_blocking(|| wait_for_game_start(420)).await {
        Ok(GameStartWait::Started(gt)) => gt,
        Ok(GameStartWait::WindowClosed) => {
            obs_recorder::discard_prepared();
            return Err("League of Legends window closed before the game started".to_string());
        }
        _ => 0.0, // Timeout: start anyway, no gameTime info
    };

    // Phase 2 — BEGIN: with OBS already warm, starting the output lands within
    // a frame or two of the target in-game second instead of 2s late.
    tauri::async_runtime::spawn_blocking(obs_recorder::begin)
        .await
        .map_err(|e| e.to_string())??;

    // Resync: report the real in-game clock at the moment of the first frame
    // so the timeline aligns with the actual video, closing any final gap.
    let game_start_time = query_current_game_time().unwrap_or(detected_start);

    OBS_ACTIVE.store(true, std::sync::atomic::Ordering::SeqCst);
    *OBS_OUTPUT.lock().map_err(|e| e.to_string())? = Some(paths.output.clone());
    *REC_GAME_START.lock().map_err(|e| e.to_string())? = Some(game_start_time);
    // Refresh the hotkey clip length from config so the worker always uses it.
    {
        let d = read_config(&app).get("clipDuration").and_then(|v| v.as_i64()).unwrap_or(30);
        REC_CLIP_DURATION.store(normalize_clip_duration(d), std::sync::atomic::Ordering::SeqCst);
    }

    // Timeline + thumbnail (grabbed live from the game window, no ffmpeg).
    start_event_capture(paths.events);
    start_thumbnail_worker(paths.thumb);

    let result = serde_json::json!({
        "path": paths.output,
        "gameTime": game_start_time,
    });
    Ok(result.to_string())
}

#[tauri::command]
async fn stop_recording(app: tauri::AppHandle) -> Result<Option<VodFile>, String> {
    stop_event_capture();
    REC_GAME_START.lock().map_err(|e| e.to_string())?.take();

    // OBS engine: stop libobs and finalize the mp4 here (no ffmpeg child to
    // reap). libobs runs on a blocking thread, so stop it off the runtime.
    if OBS_ACTIVE.swap(false, std::sync::atomic::Ordering::SeqCst) {
        let duration = tauri::async_runtime::spawn_blocking(|| obs_recorder::stop())
            .await
            .map_err(|e| e.to_string())??;
        let output_path = OBS_OUTPUT.lock().map_err(|e| e.to_string())?.take();
        let recordings = read_config(&app)
            .get("recordingsFolder")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(default_recordings_folder);
        let valid_path = output_path.as_deref().and_then(|p| {
            let meta = std::fs::metadata(p).ok()?;
            let size = meta.len();
            if size < 50_000 {
                audio_log(&format!("VOD too small ({size} bytes), discarding: {p}"));
                let _ = std::fs::remove_file(p);
                return None;
            }
            Some(p)
        });
        return Ok(valid_path.map(|path| VodFile {
            path: path.to_string(),
            duration,
            clips: realize_pending_clips(path, &recordings),
        }));
    }

    // No engine active: nothing to stop.
    Ok(None)
}

/// Removes a VOD and all its associated files from disk (mp4, events.json,
/// thumbnail, ffmpeg log). Called from the frontend when the user deletes a VOD.
#[tauri::command]
fn delete_vod(video_path: String) -> Result<(), String> {
    let base = std::path::Path::new(&video_path);
    let _ = std::fs::remove_file(base);
    let _ = std::fs::remove_file(vod_sibling(&video_path, "timeline", "events.json"));
    let _ = std::fs::remove_file(vod_sibling(&video_path, "thumbnails", "thumb.jpg"));
    let _ = std::fs::remove_file(vod_sibling(&video_path, "logs", "ffmpeg.log"));
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
/// True while the game window EXISTS — regardless of minimized / occluded /
/// exclusive-fullscreen state.  Deliberately ignores visibility and rect:
/// a minimized LoL reports GetWindowRect at (-32000,-32000) and DDA-style
/// visibility checks fail, which made the recording watchdog think the game
/// had ended and cut VODs mid-match whenever something stole foreground.
/// The window is destroyed by Windows only when the game process exits,
/// which is exactly the signal we want.
fn is_lol_window_open() -> bool {
    use std::ffi::c_void;
    type HWND = *mut c_void;
    type BOOL = i32;
    type LPARAM = isize;
    type WNDENUMPROC = Option<unsafe extern "system" fn(HWND, LPARAM) -> BOOL>;

    extern "system" {
        fn EnumWindows(lpEnumFunc: WNDENUMPROC, lParam: LPARAM) -> BOOL;
        fn GetWindowTextW(hWnd: HWND, lpString: *mut u16, nMaxCount: i32) -> i32;
    }

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let mut buf = [0u16; 256];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 256);
        if len > 0 {
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title.contains("League of Legends (TM) Client") {
                let slot = &*(lparam as *const Mutex<bool>);
                if let Ok(mut guard) = slot.lock() {
                    *guard = true;
                }
                return 0;
            }
        }
        1
    }

    let result: Mutex<bool> = Mutex::new(false);
    let ptr = &result as *const Mutex<bool> as LPARAM;
    unsafe {
        let _ = EnumWindows(Some(callback), ptr);
    }
    result.lock().map(|g| *g).unwrap_or(false)
}

/// Returns the locally captured LCD events for a recording (instant
/// timeline), or None when the capture file does not exist.
#[tauri::command]
fn read_vod_events(video_path: String) -> Option<String> {
    let p = vod_sibling(&video_path, "timeline", "events.json");
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
    let p = vod_sibling(&video_path, "thumbnails", "thumb.jpg");
    if p.is_file() {
        Some(p.to_string_lossy().to_string())
    } else {
        None
    }
}

#[tauri::command]
async fn is_recording() -> Result<bool, String> {
    Ok(OBS_ACTIVE.load(std::sync::atomic::Ordering::SeqCst))
}

/* ── Overlay window control ────────────────────────────────────────────────
   The in-game "Recording" card is DISABLED: showing a topmost webview window
   over a true-exclusive-fullscreen League client kicks it out of exclusive
   mode, which (combined with the focus watchdog) produced the repeated
   minimize / black-flash at recording start. show/hide_overlay are no-ops
   now; the recording state is shown only in the main app window.
   ------------------------------------------------------------------------ */
fn overlay_hwnd(app: &tauri::AppHandle) -> Option<isize> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("overlay") {
        if let Ok(h) = win.hwnd() {
            return Some(h.0 as isize);
        }
    }
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::FindWindowW;
        use windows::core::w;
        FindWindowW(None, w!("Overlay")).ok().map(|h| h.0 as isize)
    }
}

/// Idempotent: strip any ability to take focus, even when clicked.
/// WS_EX_TRANSPARENT makes the window completely click-through (mouse
/// events pass to whatever is behind it).  WS_EX_LAYERED is required
/// for TRANSPARENT to work and is already set by Tauri's transparent
/// window flag.
unsafe fn apply_overlay_noactivate(hwnd: isize) {
    use std::ffi::c_void;
    type HWND = *mut c_void;
    extern "system" {
        fn GetWindowLongPtrW(hWnd: HWND, nIndex: i32) -> isize;
        fn SetWindowLongPtrW(hWnd: HWND, nIndex: i32, dwNewLong: isize) -> isize;
    }
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_NOACTIVATE: isize = 0x0800_0000;
    const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
    const WS_EX_TRANSPARENT: isize = 0x0000_0020;
    let h = hwnd as HWND;
    let st = GetWindowLongPtrW(h, GWL_EXSTYLE);
    SetWindowLongPtrW(h, GWL_EXSTYLE, st | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT);
}

#[tauri::command]
async fn show_overlay(_app: tauri::AppHandle, _lang: String) -> Result<(), String> {
    // No-op: the in-game recording card is disabled so it never kicks the game
    // out of exclusive fullscreen (see block comment above).
    Ok(())
}

#[tauri::command]
async fn hide_overlay(_app: tauri::AppHandle) -> Result<(), String> {
    // No-op: see show_overlay.
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Is this process running with administrator privileges? OBS game capture
/// needs this to open the Vanguard-protected League of Legends process.
fn is_elevated() -> bool {
    unsafe {
        use windows::Win32::UI::Shell::IsUserAnAdmin;
        IsUserAnAdmin().as_bool()
    }
}

/// Relaunch this executable elevated (UAC) via ShellExecuteW "runas".
/// Returns true if a new elevated instance was launched; the caller should
/// then exit this (non-elevated) instance.
fn relaunch_elevated() -> bool {
    unsafe {
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let exe = std::env::current_exe().ok();
        let Some(exe) = exe else { return false; };
        let Ok(exe) = exe.into_os_string().into_string() else { return false; };
        let w_exe: Vec<u16> = exe.encode_utf16().chain(std::iter::once(0)).collect();
        let verb: Vec<u16> = "runas".encode_utf16().chain(std::iter::once(0)).collect();
        let code = ShellExecuteW(
            windows::Win32::Foundation::HWND(std::ptr::null_mut()),
            windows::core::PCWSTR(verb.as_ptr()),
            windows::core::PCWSTR(w_exe.as_ptr()),
            windows::core::PCWSTR(std::ptr::null()),
            windows::core::PCWSTR(std::ptr::null()),
            SW_SHOWNORMAL,
        );
        code.0 as isize > 32
    }
}

/// True when the user has enabled the OBS capture engine (reads config JSON
/// directly from disk so it works before the Tauri AppHandle exists).
fn obs_capture_enabled() -> bool {
    let path = std::env::var_os("APPDATA")
        .map(std::path::PathBuf::from)
        .map(|d| d.join("com.rifthelper.desktop").join("config.json"));
    let Some(path) = path else { return false };
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("useObsCapture").and_then(|v| v.as_bool()).or(Some(true)))
        .unwrap_or(true)
}

/// Prepare the process to run the OBS capture engine:
///  1. Relaunch elevated (UAC) so game capture can open LoL.
///  2. Ensure the OBS binaries are installed next to the exe (downloads on
///     first run and, if a stale libobs dll is loaded, relaunches again).
/// Only runs when the user enabled OBS capture (`useObsCapture`), and is
/// skipped entirely during development via `RIFTHELPER_NO_ELEVATE=1`.
fn ensure_obs_runtime() {
    if !obs_capture_enabled() {
        return;
    }
    if std::env::var_os("RIFTHELPER_NO_ELEVATE").is_none() && !is_elevated() {
        if relaunch_elevated() {
            std::process::exit(0);
        }
    }

    // Bootstrap libobs binaries (idempotent; `Restart` means a fresh libobs
    // dll landed on disk and this process must relaunch once to pick it up).
    let rt = tokio::runtime::Runtime::new();
    if let Ok(rt) = rt {
        match rt.block_on(obs_recorder::ensure_obs()) {
            Ok(true) => {
                // A fresh libobs dll was installed; relaunch once to load it.
                if relaunch_elevated() {
                    std::process::exit(0);
                }
            }
            _ => {}
        }
    }
}

pub fn run() {
    ensure_obs_runtime();

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
            get_start_minimized,
            set_start_minimized,
            get_focus_after_game,
            set_focus_after_game,
            get_clip_hotkey,
            set_clip_hotkey,
            get_clip_duration,
            set_clip_duration,
            focus_window,
            get_recordings_folder,
            set_recordings_folder,
            select_recordings_folder,
            export_highlight_copy,
            create_manual_clip,
            get_auto_record,
            set_auto_record,
            get_audio_mode,
            set_audio_mode,
            get_mute_mic,
            set_mute_mic,
            get_use_obs_capture,
            set_use_obs_capture,
            setup_obs_capture,
            list_audio_output_devices,
            get_audio_output_device,
            set_audio_output_device,
            get_recording_fps,
            set_recording_fps,
            get_recording_quality,
            set_recording_quality,
            get_disk_usage,
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
        ]);

    builder = builder
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder};

            let window = app.get_webview_window("main").unwrap();

            // Overlay is born parked offscreen; make it permanently
            // unfocusable so it can never steal foreground from the game.
            if let Some(oh) = overlay_hwnd(&app.handle()) {
                unsafe { apply_overlay_noactivate(oh) };
            }

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

            // Seed the clip hotkey + duration and start the global hotkey
            // worker. Autostart may launch us with `--minimized`.
            {
                let cfg = read_config(&app.handle());
                let hk = cfg.get("clipHotkey").and_then(|v| v.as_str()).unwrap_or("F9").to_string();
                *CLIP_HOTKEY_NAME.lock().unwrap_or_else(|e| e.into_inner()) = Some(hk.clone());
                let d = cfg.get("clipDuration").and_then(|v| v.as_i64()).unwrap_or(30);
                REC_CLIP_DURATION.store(normalize_clip_duration(d), std::sync::atomic::Ordering::SeqCst);
                let start_minimized = cfg.get("startMinimized").and_then(|v| v.as_bool()).unwrap_or(false);
                let arg_minimized = std::env::args().any(|a| a.eq_ignore_ascii_case("--minimized"));
                if start_minimized || arg_minimized {
                    let _ = window.minimize();
                }
            }
            spawn_hotkey_worker();

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
                            if OBS_ACTIVE.swap(false, std::sync::atomic::Ordering::SeqCst) {
                                let _ = obs_recorder::stop();
                            }
                            obs_recorder::discard_prepared();
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
                    if OBS_ACTIVE.swap(false, std::sync::atomic::Ordering::SeqCst) {
                        let _ = obs_recorder::stop();
                    }
                    obs_recorder::discard_prepared();
                }
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
