use serde::Serialize;
use tauri::Emitter;
use tauri::Manager;
use std::sync::Mutex;
use std::process::{Command, Child};

static FFMPEG_CHILD: Mutex<Option<Child>> = Mutex::new(None);
static FFMPEG_OUTPUT: Mutex<Option<String>> = Mutex::new(None);

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
        .output()
        .map_err(|e| e.to_string())?;
    Ok(output.status.success())
}

#[tauri::command]
async fn get_auto_record(app: tauri::AppHandle) -> Result<bool, String> {
    let cfg = read_config(&app);
    Ok(cfg.get("autoRecord")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

#[tauri::command]
async fn set_auto_record(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut cfg = read_config(&app);
    cfg["autoRecord"] = serde_json::json!(enabled);
    write_config(&app, &cfg);
    Ok(())
}

#[tauri::command]
async fn start_recording(app: tauri::AppHandle) -> Result<String, String> {
    {
        let guard = FFMPEG_CHILD.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("Already recording".to_string());
        }
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

    let child = Command::new(&ffmpeg_path)
        .args([
            "-f", "gdigrab",
            "-framerate", "30",
            "-i", "desktop",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-y",
            &output_str,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;

    {
        let mut guard = FFMPEG_CHILD.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);
    }
    {
        let mut guard = FFMPEG_OUTPUT.lock().map_err(|e| e.to_string())?;
        *guard = Some(output_str.clone());
    }

    Ok(output_str)
}

#[tauri::command]
async fn stop_recording() -> Result<Option<String>, String> {
    {
        let mut guard = FFMPEG_CHILD.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *guard {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }
    let mut guard = FFMPEG_OUTPUT.lock().map_err(|e| e.to_string())?;
    Ok(guard.take())
}

#[tauri::command]
async fn is_recording() -> Result<bool, String> {
    let mut guard = FFMPEG_CHILD.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(Some(_)) => { *guard = None; Ok(false) }
            Ok(None) => Ok(true),
            Err(_) => { *guard = None; Ok(false) }
        }
    } else {
        Ok(false)
    }
}

const FFMPEG_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

#[tauri::command]
async fn download_and_setup_ffmpeg(app: tauri::AppHandle) -> Result<String, String> {

    #[derive(Serialize)]
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
            start_recording,
            stop_recording,
            is_recording,
            download_and_setup_ffmpeg,
        ]);

    builder = builder
        .setup(|app| {
            use tauri::menu::{MenuBuilder, MenuItemBuilder};

            let window = app.get_webview_window("main").unwrap();

            let show_item = MenuItemBuilder::with_id("show", "Show RiftHelper").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).item(&show_item).item(&quit_item).build()?;

            let tray = app.tray_by_id("main-tray");

            if let Some(tray) = tray {
                tray.set_menu(Some(menu));

                let window_show = window.clone();
                tray.on_menu_event(move |_app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            let _ = window_show.show();
                            let _ = window_show.set_focus();
                        }
                        "quit" => {
                            if let Ok(mut guard) = FFMPEG_CHILD.lock() {
                                if let Some(ref mut child) = *guard {
                                    let _ = child.kill();
                                    let _ = child.wait();
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
                    if let Ok(mut guard) = FFMPEG_CHILD.lock() {
                        if let Some(ref mut child) = *guard {
                            let _ = child.kill();
                            let _ = child.wait();
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
