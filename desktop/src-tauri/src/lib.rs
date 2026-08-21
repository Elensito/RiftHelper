use serde::Serialize;
use tauri::Manager;
use std::sync::Mutex;

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
        ]);

    builder = builder
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            let _app_handle = app.handle().clone();

            let tray_icon = app.tray_by_id("main-tray");
            if let Some(tray) = tray_icon {
                let _window = window.clone();
                tray.on_menu_event(move |_app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            let _ = _window.show();
                            let _ = _window.set_focus();
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                });
                let window_clone = window.clone();
                tray.on_tray_icon_event(move |_tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = window_clone.show();
                        let _ = window_clone.set_focus();
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
                }
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
