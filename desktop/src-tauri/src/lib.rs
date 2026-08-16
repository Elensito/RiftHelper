use serde::Serialize;

#[derive(Serialize)]
struct RiotSession {
    game_name: String,
    game_tag: String,
    puuid: String,
    region: String,
}

fn read_riot_session() -> Option<RiotSession> {
    let program_data =
        std::env::var("PROGRAMDATA").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    let installs_path = std::path::Path::new(&program_data)
        .join("Riot Games")
        .join("RiotClientInstalls.json");
    let installs_text = std::fs::read_to_string(installs_path).ok()?;
    let installs: serde_json::Value = serde_json::from_str(&installs_text).ok()?;
    let install_dir = installs
        .get("rc_default")
        .or_else(|| installs.get("rc_live"))
        .or_else(|| installs.get("installed_path"))
        .and_then(|v| v.as_str())
        .map(str::to_string)?;

    let lockfile_path = std::path::Path::new(&install_dir).join("Lockfile");
    let lockfile = std::fs::read_to_string(lockfile_path).ok()?;
    let parts: Vec<&str> = lockfile.split(':').collect();
    if parts.len() < 5 {
        return None;
    }
    let port = parts[2].to_string();
    let password = parts[3].to_string();

    let client = reqwest::blocking::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .ok()?;
    let url = format!("https://127.0.0.1:{}/chat/v1/session", port);
    let resp = client
        .get(&url)
        .basic_auth("riot", Some(password))
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: serde_json::Value = resp.json().ok()?;
    if body.get("sessionState").and_then(|v| v.as_str()).unwrap_or("") != "CONNECTED" {
        return None;
    }
    let text = |k: &str| body.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let session = RiotSession {
        game_name: text("game_name"),
        game_tag: text("game_tag"),
        puuid: text("puuid"),
        region: text("region"),
    };
    if session.puuid.is_empty() {
        return None;
    }
    Some(session)
}

#[tauri::command]
async fn get_riot_client_session() -> Option<RiotSession> {
    tauri::async_runtime::spawn_blocking(read_riot_session)
        .await
        .ok()
        .flatten()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![get_riot_client_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
