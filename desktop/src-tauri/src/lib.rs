use tauri_plugin_updater::UpdaterExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                std::thread::sleep(std::time::Duration::from_secs(5));
                check_for_updates(handle).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn check_for_updates(app: tauri::AppHandle) {
    let Ok(updater) = app.updater() else {
        return;
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let downloaded = update.download(|_, _| {}, || {}).await;
            if let Ok(bytes) = downloaded {
                let _ = update.install(bytes);
            }
        }
        _ => {}
    }
}
