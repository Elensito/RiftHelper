//! Standalone prototype: validate the OBS/libobs game-capture path that we
//! want RiftHelper to migrate to (same engine Ascent uses).
//!
//! 1. Bootstraps OBS binaries next to this exe (libobs-bootstrapper).
//! 2. Creates an ObsContext (startup paths default to the exe dir).
//! 3. Finds the League of Legends window that supports game capture.
//! 4. Adds a GameCaptureSource (injected graphics-hook + shared texture,
//!    GPU -> NVENC without CPU readback).
//! 5. Enables game audio capture (wasapi_process_output_capture).
//! 6. Records N seconds to an mp4 via a SimpleOutputBuilder with a hardware
//!    (NVENC/AMF/QSV) encoder + AAC audio.
//! 7. Stops and verifies the file was produced.
//!
//! Usage: obs_probe.exe [seconds] [out.mp4]

use std::time::Duration;

use libobs_bootstrapper::{
    ObsBootstrapper, ObsBootstrapperOptions, ObsBootstrapperResult,
    status_handler::ObsBootstrapConsoleHandler,
};
use libobs_simple::{
    output::simple::ObsContextSimpleExt,
    sources::{ObsSourceBuilder, windows::GameCaptureSourceBuilder},
};
use libobs_wrapper::{
    context::ObsContext,
    data::output::ObsOutputTrait,
    utils::{ObsPath, StartupInfo},
};

/// Locate the LoL in-game window directly (the libobs window-helper skips it:
/// LoL's window carries WS_EX_TOOLWINDOW / WS_CHILD styles).
/// Returns (hwnd, title, class, exe).
fn find_league_window() -> Option<(isize, String, String, String)> {
    use std::ffi::c_void;
    use std::sync::Mutex;
    type HWND = *mut c_void;
    type BOOL = i32;
    type DWORD = u32;
    type LPARAM = isize;
    type WNDENUMPROC = Option<unsafe extern "system" fn(HWND, LPARAM) -> BOOL>;

    extern "system" {
        fn EnumWindows(lpEnumFunc: WNDENUMPROC, lParam: LPARAM) -> BOOL;
        fn GetWindowTextW(hWnd: HWND, lpString: *mut u16, nMaxCount: i32) -> i32;
        fn GetClassNameW(hWnd: HWND, lpString: *mut u16, nMaxCount: i32) -> i32;
        fn IsWindowVisible(hWnd: HWND) -> BOOL;
        fn GetWindowThreadProcessId(hWnd: HWND, lpdwProcessId: *mut DWORD) -> DWORD;
        fn OpenProcess(dwDesiredAccess: DWORD, bInheritHandle: BOOL, dwProcessId: DWORD) -> *mut c_void;
        fn QueryFullProcessImageNameW(
            hProcess: *mut c_void,
            dwFlags: DWORD,
            lpExeName: *mut u16,
            lpdwSize: *mut DWORD,
        ) -> BOOL;
        fn CloseHandle(hObject: *mut c_void) -> BOOL;
    }
    const PROCESS_QUERY_LIMITED_INFORMATION: DWORD = 0x1000;

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let slot = &*(lparam as *const Mutex<Option<(isize, String, String)>>);
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 512);
        if len > 0 && IsWindowVisible(hwnd) != 0 {
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title.contains("League of Legends (TM) Client") {
                let mut class = [0u16; 256];
                let clen = GetClassNameW(hwnd, class.as_mut_ptr(), 256);
                let class = if clen > 0 {
                    String::from_utf16_lossy(&class[..clen as usize])
                } else {
                    String::new()
                };
                if let Ok(mut g) = slot.lock() {
                    *g = Some((hwnd as isize, title, class));
                }
                return 0;
            }
        }
        1
    }

    let result: Mutex<Option<(isize, String, String)>> = Mutex::new(None);
    let ptr = &result as *const Mutex<Option<(isize, String, String)>> as LPARAM;
    unsafe {
        let _ = EnumWindows(Some(callback), ptr);
    }
    let (hwnd, title, class) = result.lock().ok()?.take()?;

    // Resolve the executable of the owning PID.
    let mut pid: u32 = 0;
    unsafe {
        let _ = GetWindowThreadProcessId(hwnd as HWND, &mut pid);
    }
    let exe = unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            "League of Legends.exe".to_string()
        } else {
            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
            CloseHandle(handle);
            if ok != 0 {
                String::from_utf16_lossy(&buf[..size as usize])
            } else {
                "League of Legends.exe".to_string()
            }
        }
    };

    Some((hwnd, title, class, exe))
}

fn run_probe(seconds: u64, out_file: &str) -> anyhow::Result<()> {
    println!("[obs_probe] creating OBS context...");
    let mut context = ObsContext::new(StartupInfo::default())?;

    let mut scene = context.scene("MAIN", Some(0))?;

    // The libobs window-helper skips LoL's window (WS_EX_TOOLWINDOW/WS_CHILD
    // style), so locate it directly via EnumWindows, like the app itself does.
    let Some((hwnd, title, class, exe)) = find_league_window() else {
        anyhow::bail!(
            "No League of Legends window found. Start the game and run again. \
             Note: another OBS instance or this app capturing the same game blocks the hook."
        );
    };
    println!(
        "[obs_probe] league window: hwnd={hwnd:#x} title={title:?} class={class:?} exe={exe:?}"
    );
    // OBS game-capture window id is "title:class:exe".
    let win_class = if class.is_empty() { title.clone() } else { class };
    let obs_id = format!("{title}:{win_class}:{exe}");

    let game_capture = context
        .source_builder::<GameCaptureSourceBuilder, _>("Game")?
        .set_window_raw(obs_id)
        .set_capture_audio(true)? // wasapi_process_output_capture, auto-route to mix
        .add_to_scene(&mut scene)?;
    let _ = game_capture;

    println!("[obs_probe] creating output: {out_file}");
    let mut output = context
        .simple_output_builder("probe-output", ObsPath::new(out_file))
        .video_bitrate(24000)
        .audio_bitrate(192)
        // NVENC/AMF/QSV chosen at runtime by the wrapper.
        .hardware_encoder(
            libobs_simple::output::simple::HardwareCodec::H264,
            libobs_simple::output::simple::HardwarePreset::Balanced,
        )
        .build()?;

    println!("[obs_probe] recording for {seconds}s...");
    output.start()?;
    std::thread::sleep(Duration::from_secs(seconds));
    output.stop()?;

    // Keep the context alive long enough for the muxer to finalize.
    std::thread::sleep(Duration::from_secs(1));

    let meta = std::fs::metadata(out_file)?;
    println!(
        "[obs_probe] done. {out_file}: {} bytes ({:.1} MiB)",
        meta.len(),
        meta.len() as f64 / 1024.0 / 1024.0
    );
    if meta.len() < 1_000_000 {
        anyhow::bail!(
            "Output file is suspiciously small; capture may have failed (no hook / no HW encoder)."
        );
    }

    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::init();
    let mut args = std::env::args().skip(1);
    let seconds: u64 = args
        .next()
        .map(|s| s.parse().unwrap_or(10))
        .unwrap_or(10);
    let out_file = args.next().unwrap_or_else(|| "obs_probe.mp4".to_string());

    println!("[obs_probe] bootstrapping OBS binaries...");
    let result = ObsBootstrapper::bootstrap_with_handler(
        &ObsBootstrapperOptions::default(),
        Box::new(ObsBootstrapConsoleHandler::default()),
    )
    .await?;
    if matches!(result, ObsBootstrapperResult::Restart) {
        println!("[obs_probe] OBS installed, restart required to load new dll");
        println!("[obs_probe] run this again to continue the probe");
        return Ok(());
    }

    // Run the OBS recording synchronously on a dedicated thread so OBS's own
    // threads aren't driven by / blocked on the tokio runtime.
    let (tx, rx) = std::sync::mpsc::channel();
    let out_owned = out_file.clone();
    std::thread::spawn(move || {
        let res = run_probe(seconds, &out_owned);
        let _ = tx.send(res);
    });
    match rx.recv()? {
        Ok(()) => println!("[obs_probe] OK"),
        Err(e) => {
            eprintln!("[obs_probe] ERROR: {e:#}");
            std::process::exit(1);
        }
    }

    Ok(())
}
