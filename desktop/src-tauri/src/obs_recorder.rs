//! OBS/libobs-based game-capture recorder — the same engine Ascent uses.
//!
//! Replaces RiftHelper's DDA + ffmpeg rawvideo pipeline with GPU shared-texture
//! capture (graphics-hook injection → shared D3D11 texture → hardware encoder
//! on the GPU). No per-frame CPU readback / pipe copy, which is the bottleneck
//! that lowered performance vs Ascent.
//!
//! Requires the process to run elevated: OBS game capture cannot open
//! anti-cheat-protected processes (Vanguard) without admin privileges.
//!
//! Lifecycle:
//!   ensure_obs()        — ensure OBS binaries exist next to the exe. On a
//!                         bundled install they are shipped beside the exe via
//!                         tauri `bundle.resources`; dev builds fall back to
//!                         download/extract (once).
//!   start(...)          — create OBS context, scene, sources, output; begin.
//!   stop()              — stop the output, finalize the mp4, keep context.
//!   shutdown()          — tear the whole OBS context down.

use std::sync::Mutex;
use std::time::Duration;

use libobs_simple::output::simple::ObsContextSimpleExt;
use libobs_simple::sources::{ObsSourceBuilder, windows::GameCaptureSourceBuilder};
use libobs_wrapper::{
    context::ObsContext,
    data::{ImmutableObsData, ObsData, ObsDataSetters},
    data::output::ObsOutputTrait,
    runtime::ObsRuntime,
    scenes::{ObsSceneRef, SceneItemExtSceneTrait},
    sources::ObsSourceRef,
    utils::{ObsPath, StartupInfo},
};

/// Which audio mix the user wants, mirroring the app's `AudioMode`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ObsAudioMode {
    /// Only the game (LoL). Captured via the game source's "capture audio".
    Game,
    /// Everything on the default desktop endpoint.
    System,
    /// LoL + Discord voice.
    GameDiscord,
}

/// A configuration for one recording session.
pub struct ObsRecordingConfig {
    /// Absolute output .mp4 path.
    pub output_path: String,
    /// Requested frames-per-second (e.g. "30" or "60").
    pub fps: u32,
    /// Target output height (480/720/1080), or 0 for native.
    pub height: u32,
    /// Video bitrate in kbps (NVENC/AMF/QSV).
    pub video_bitrate: u32,
    /// Audio bitrate in kbps.
    pub audio_bitrate: u32,
    /// Audio mix to capture.
    pub audio_mode: ObsAudioMode,
    /// For `System`: the audio endpoint device id (empty = default).
    pub audio_output_device: Option<String>,
    /// Store the LoL window id captured so stop can log/verify.
    pub capture_window_id: Option<String>,
}

/// Holds the active OBS recording session.
struct ActiveRec {
    _context: ObsContext,
    _scene: ObsSceneRef,
    output: libobs_wrapper::data::output::ObsOutputRef,
    fps: u32,
}

static ACTIVE: Mutex<Option<ActiveRec>> = Mutex::new(None);
static OBS_READY: Mutex<bool> = Mutex::new(false);

/// Locate the LoL in-game window directly (the libobs window-helper skips it:
/// LoL's window carries WS_EX_TOOLWINDOW / WS_CHILD styles).
/// Returns (hwnd, title, class, exe_path).
fn find_league_window() -> Option<(isize, String, String, String)> {
    use std::ffi::c_void;
    use std::sync::Mutex as StdMutex;
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
        fn OpenProcess(dwDesiredAccess: DWORD, bInheritHandle: BOOL, dwProcessId: DWORD)
            -> *mut c_void;
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
        let slot = &*(lparam as *const StdMutex<Option<(isize, String, String)>>);
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

    let result: StdMutex<Option<(isize, String, String)>> = StdMutex::new(None);
    let ptr = &result as *const StdMutex<Option<(isize, String, String)>> as LPARAM;
    unsafe {
        let _ = EnumWindows(Some(callback), ptr);
    }
    let (hwnd, title, class) = result.lock().ok()?.take()?;

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

/// Locate the first visible top-level window owned by the process whose
/// executable file name equals `process_name` (case-insensitive). Returns the
/// OBS window id in "title:class:exe" form.
fn window_id_by_process(process_name: &str) -> Option<String> {
    use std::ffi::c_void;
    use std::sync::Mutex as StdMutex;
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
        fn OpenProcess(dwDesiredAccess: DWORD, bInheritHandle: BOOL, dwProcessId: DWORD)
            -> *mut c_void;
        fn QueryFullProcessImageNameW(
            hProcess: *mut c_void,
            dwFlags: DWORD,
            lpExeName: *mut u16,
            lpdwSize: *mut DWORD,
        ) -> BOOL;
        fn CloseHandle(hObject: *mut c_void) -> BOOL;
    }
    const PROCESS_QUERY_LIMITED_INFORMATION: DWORD = 0x1000;

    struct Found {
        title: String,
        class: String,
        exe: String,
    }

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let pair = &*(lparam as *const (StdMutex<Option<Found>>, String));
        let slot = &pair.0;
        let needle = &pair.1;
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), 512);
        if len <= 0 {
            return 1;
        }
        let title = String::from_utf16_lossy(&buf[..len as usize]);
        let mut pid: u32 = 0;
        let _ = GetWindowThreadProcessId(hwnd, &mut pid);
        let exe = {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                String::new()
            } else {
                let mut ebuf = [0u16; 1024];
                let mut size = ebuf.len() as u32;
                let ok = QueryFullProcessImageNameW(handle, 0, ebuf.as_mut_ptr(), &mut size);
                CloseHandle(handle);
                if ok != 0 {
                    String::from_utf16_lossy(&ebuf[..size as usize])
                } else {
                    String::new()
                }
            }
        };
        // Match on the executable file name (case-insensitive).
        let basename = std::path::Path::new(&exe)
            .file_name()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if basename == needle.to_lowercase() {
            let mut class = [0u16; 256];
            let clen = GetClassNameW(hwnd, class.as_mut_ptr(), 256);
            let class = if clen > 0 {
                String::from_utf16_lossy(&class[..clen as usize])
            } else {
                String::new()
            };
            if let Ok(mut g) = slot.lock() {
                *g = Some(Found { title, class, exe });
            }
            return 0;
        }
        1
    }

    let tuple = (StdMutex::new(None), process_name.to_string());
    let ptr = &tuple as *const (StdMutex<Option<Found>>, String) as LPARAM;
    unsafe {
        let _ = EnumWindows(Some(callback), ptr);
    }
    let found: Found = tuple.0.lock().ok()?.take()?;
    let win_class = if found.class.is_empty() { found.title.clone() } else { found.class };
    Some(format!("{}:{}:{}", found.title, win_class, found.exe))
}

/// OBS window id for the Discord client, used for the "Game + Discord" mix.
pub fn discord_window_id() -> Option<String> {
    window_id_by_process("Discord.exe")
}

/// Build the OBS game-capture window id ("title:class:exe") for the LoL window.
pub fn league_window_id() -> Option<String> {
    let (_hwnd, title, class, exe) = find_league_window()?;
    let win_class = if class.is_empty() { title.clone() } else { class };
    Some(format!("{title}:{win_class}:{exe}"))
}

/// True if a League of Legends in-game window is currently present.
#[allow(dead_code)]
pub fn league_window_present() -> bool {
    find_league_window().is_some()
}

fn make_video_info(fps: u32, height: u32) -> libobs_wrapper::data::video::ObsVideoInfo {
    let mut b = libobs_wrapper::data::video::ObsVideoInfoBuilder::new();
    b = b.fps_num(fps).fps_den(1);
    if height > 0 {
        // Set BOTH dimensions to a true 16:9 frame. Setting only output_height
        // left output_width at its default (the primary display width, e.g.
        // 2560 or 3840), producing a very wide, short canvas like 2560x720
        // that rendered as "narrow frames with little height".
        let width = (height as u64 * 16 / 9) as u32;
        b = b.output_width(width).output_height(height);
    }
    b.build()
}

/// Start an OBS game-capture recording. Returns an error message on failure.
///
/// Must be called on a non-tokio blocking thread (e.g. `spawn_blocking`):
/// libobs's run loop must not be driven by / blocked on the async runtime.
/// Guarantees: OBS binaries are already installed (`ensure_obs` called first).
pub fn start(config: ObsRecordingConfig) -> Result<(), String> {
    {
        let guard = ACTIVE.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("Already recording via OBS".into());
        }
    }

    let Some(window_id) = config.capture_window_id.clone().or_else(league_window_id) else {
        return Err("League of Legends window not found for OBS capture".into());
    };

    let video_info = make_video_info(config.fps, config.height);
    let startup = StartupInfo::new().set_video_info(video_info);
    let mut context = ObsContext::new(startup).map_err(|e| format!("OBS context init: {e}"))?;
    let runtime: ObsRuntime = context.runtime().clone();

    let mut scene = context.scene("MAIN", Some(0)).map_err(|e| format!("OBS scene: {e}"))?;

    // Video: always the LoL game capture.
    let capture_game_audio =
        matches!(config.audio_mode, ObsAudioMode::Game) || matches!(config.audio_mode, ObsAudioMode::GameDiscord);
    let game_builder = context
        .source_builder::<GameCaptureSourceBuilder, _>("Game")
        .map_err(|e| format!("OBS game capture source: {e}"))?
        .set_window_raw(window_id);
    let game_builder = if capture_game_audio {
        game_builder
            .set_capture_audio(true)
            .map_err(|e| format!("OBS game capture audio: {e}"))?
    } else {
        game_builder
    };
    game_builder
        .add_to_scene(&mut scene)
        .map_err(|e| format!("OBS add game source to scene: {e}"))?;

    // Audio extras per mode:
    //   Game        -> game source audio only (done above).
    //   System      -> desktop WASAPI endpoint (includes the game).
    //   GameDiscord -> game source audio + a per-process WASAPI capture of Discord.
    match config.audio_mode {
        ObsAudioMode::System => {
            let device = config.audio_output_device.unwrap_or_default();
            add_wasapi_source(
                &context,
                &mut scene,
                &runtime,
                "wasapi_output_capture",
                "Desktop Audio",
                "device_id",
                &device,
            )?;
        }
        ObsAudioMode::GameDiscord => {
            if let Some(discord_id) = discord_window_id() {
                add_wasapi_source(
                    &context,
                    &mut scene,
                    &runtime,
                    "wasapi_process_output_capture",
                    "Discord Audio",
                    "window",
                    &discord_id,
                )?;
            }
        }
        ObsAudioMode::Game => {}
    }

    let output = context
        .simple_output_builder("rift-output", ObsPath::new(&config.output_path))
        .video_bitrate(config.video_bitrate)
        .audio_bitrate(config.audio_bitrate)
        .hardware_encoder(
            libobs_simple::output::simple::HardwareCodec::H264,
            libobs_simple::output::simple::HardwarePreset::Speed,
        )
        .build()
        .map_err(|e| format!("OBS output setup: {e}"))?;

    output
        .start()
        .map_err(|e| format!("OBS output start: {e}"))?;

    {
        let mut guard = ACTIVE.lock().map_err(|e| e.to_string())?;
        *guard = Some(ActiveRec {
            _context: context,
            _scene: scene,
            output,
            fps: config.fps,
        });
    }
    Ok(())
}

/// Create a generic OBS source by id with a single string property and attach
/// it to the scene so it feeds the recording mix.
fn add_wasapi_source(
    context: &ObsContext,
    scene: &mut ObsSceneRef,
    runtime: &ObsRuntime,
    source_id: &str,
    name: &str,
    prop_key: &str,
    prop_value: &str,
) -> Result<(), String> {
    let mut settings: ObsData = context.data().map_err(|e| format!("OBS data: {e}"))?;
    settings
        .set_string(prop_key, prop_value)
        .map_err(|e| format!("OBS set {prop_key}: {e}"))?;
    let settings: ImmutableObsData = settings.into_immutable();
    let source = ObsSourceRef::new(source_id, name, Some(settings), None, runtime.clone())
        .map_err(|e| format!("OBS create {name}: {e}"))?;
    scene
        .add_source(source)
        .map_err(|e| format!("OBS add {name} to scene: {e}"))?;
    Ok(())
}

/// Stop the active OBS recording and finalize the mp4. Returns the recording
/// duration in seconds (derived from the output's video-frame counter, so it is
/// valid without ffmpeg/ffprobe).
pub fn stop() -> Result<f64, String> {
    let active = ACTIVE.lock().map_err(|e| e.to_string())?.take();
    match active {
        Some(mut rec) => {
            rec.output.stop().map_err(|e| format!("OBS output stop: {e}"))?;
            // Allow the muxer to finalize.
            std::thread::sleep(Duration::from_millis(800));

            // Video duration = video frames / fps. libobs keeps counting frames
            // even after stop, so this is accurate.
            use libobs_wrapper::data::object::ObsObjectTrait;
            let total_frames = unsafe {
                libobs::obs_output_get_total_frames(rec.output.as_ptr().get_ptr())
            };
            let duration = if rec.fps > 0 && total_frames > 0 {
                (total_frames as f64) / (rec.fps as f64)
            } else {
                0.0
            };

            // Drop output, scene, then context in reverse order.
            drop(rec.output);
            drop(rec._scene);
            drop(rec._context);
            Ok(duration)
        }
        None => Err("No active OBS recording".into()),
    }
}

/// Is an OBS recording currently active?
#[allow(dead_code)]
pub fn is_active() -> bool {
    ACTIVE.lock().map(|g| g.is_some()).unwrap_or(false)
}

/// Ensure OBS binaries exist next to the exe. In a bundled install the full
/// runtime (obs.dll, obs-plugins/, data/, ...) is shipped beside the exe via
/// tauri `bundle.resources`, so we just verify it and move on. Dev builds (no
/// bundled obs.dll) fall back to the network bootstrapper to download/extract.
/// Async because the bootstrapper downloads from GitHub. Call once at startup.
///
/// Returns Ok(true) if the caller should relaunch the app (a new OBS dll was
/// installed and the current process still has an old one loaded), Ok(false)
/// if the binaries are ready to use in this process.
pub async fn ensure_obs() -> Result<bool, String> {
    {
        let ready = OBS_READY.lock().map_err(|e| e.to_string())?;
        if *ready {
            return Ok(false);
        }
    }

    // Bundled install: the OBS runtime sits right next to the exe.
    if let Some(obs_dll) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("obs.dll")))
        .filter(|p| p.is_file())
    {
        let _ = obs_dll;
        log::info!("OBS runtime already bundled next to the exe; skipping download.");
        {
            let mut ready = OBS_READY.lock().map_err(|e| e.to_string())?;
            *ready = true;
        }
        return Ok(false);
    }

    let mut options = libobs_bootstrapper::ObsBootstrapperOptions::default();
    options = options.set_no_restart(); // we relaunch the app ourselves if needed
    let result = libobs_bootstrapper::ObsBootstrapper::bootstrap_with_handler(
        &options,
        Box::new(libobs_bootstrapper::status_handler::ObsBootstrapConsoleHandler::default()),
    )
    .await
    .map_err(|e| format!("OBS bootstrap error: {e}"))?;

    let needs_restart = matches!(
        result,
        libobs_bootstrapper::ObsBootstrapperResult::Restart
    );

    {
        let mut ready = OBS_READY.lock().map_err(|e| e.to_string())?;
        *ready = !needs_restart;
    }
    Ok(needs_restart)
}
