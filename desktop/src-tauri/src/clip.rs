/* Highlight clip extraction via Windows Media Foundation transcode.
   Reads the source MP4 with a Source Reader, re-encodes the [start_sec,
   end_sec] window to H.264/AAC through a Sink Writer, and writes a fresh,
   small clip file. Self-contained (no FFmpeg / external binaries). */

use windows::core::PCWSTR;
use windows::Win32::Foundation::{FALSE, RPC_E_CHANGED_MODE, TRUE};
use windows::Win32::Media::MediaFoundation::{
    MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, MF_MT_AAC_PAYLOAD_TYPE, MF_MT_AUDIO_BITS_PER_SAMPLE,
    MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE,
    MF_MT_FRAME_SIZE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_SOURCE_READERF_ENDOFSTREAM,
    MF_SOURCE_READERF_STREAMTICK, MF_SOURCE_READER_ANY_STREAM, MFAudioFormat_AAC,
    MFCreateAttributes, MFCreateMediaType, MFCreateSinkWriterFromURL, MFCreateSourceReaderFromURL,
    MFMediaType_Audio, MFMediaType_Video, MFVideoFormat_H264, MFVideoFormat_RGB32, IMFAttributes,
    IMFMediaType, IMFSample,
};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};

/* Clip re-encode parameters. */
const VIDEO_BITRATE: u32 = 6_000_000; // 6 Mbps (matches "high" 1080p preset)
const AUDIO_BITRATE: u32 = 192_000;

/// Cut `in_path` -> `out_path` for the window [start, end] in seconds.
/// Returns Ok(()) on success.
pub fn cut_highlight(in_path: &str, out_path: &str, start_sec: f64, end_sec: f64) -> Result<(), String> {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            return Err(format!("CoInitializeEx: {hr:?}"));
        }
        let result = cut_highlight_inner(in_path, out_path, start_sec, end_sec);
        CoUninitialize();
        result
    }
}

unsafe fn cut_highlight_inner(in_path: &str, out_path: &str, start_sec: f64, end_sec: f64) -> Result<(), String> {
    // The sink writer needs a fresh output file.
    if std::path::Path::new(out_path).exists() {
        let _ = std::fs::remove_file(out_path);
    }

    let start_hns = (start_sec * 10_000_000.0) as i64;
    let end_hns = (end_sec * 10_000_000.0) as i64;

    let in_url = to_wide_url(in_path)?;
    let out_url = to_wide_url(out_path)?;

    // Source readers / sink writers may want hardware transforms.
    let mut reader_attrs: Option<IMFAttributes> = None;
    MFCreateAttributes(&mut reader_attrs, 1).map_err(|e| format!("reader attrs: {e:?}"))?;
    if let Some(a) = &reader_attrs {
        a.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1).ok();
    }

    let reader = MFCreateSourceReaderFromURL(
        PCWSTR(in_url.as_ptr()),
        reader_attrs.as_ref(),
    )
    .map_err(|e| format!("MFCreateSourceReaderFromURL: {e:?}"))?;

    // Discover the A/V streams and select them.
    let mut stream_ids: Vec<(u32, bool)> = Vec::new(); // (index, is_video)
    let mut idx = 0u32;
    let mut last_err = 0i32;
    loop {
        // Probe the media type to find the next valid stream.
        match reader.GetCurrentMediaType(idx) {
            Ok(mt) => {
                let is_video = mt_is(&mt, MFMediaType_Video)?;
                let is_audio = mt_is(&mt, MFMediaType_Audio)?;
                if is_video || is_audio {
                    reader.SetStreamSelection(idx, TRUE).map_err(|e| format!("SetStreamSelection: {e:?}"))?;
                    stream_ids.push((idx, is_video));
                } else {
                    reader.SetStreamSelection(idx, FALSE).ok();
                }
            }
            Err(e) => {
                last_err = e.code().0;
                break;
            }
        }
        idx += 1;
        if idx > 64 {
            break;
        }
    }
    if stream_ids.is_empty() {
        let extra = if last_err != 0 { format!(" (stream enum stopped: {:#010x})", last_err as u32) } else { String::new() };
        return Err(format!("no audio/video streams found{}", extra));
    }

    // Sink writer for an MP4 (container inferred from the .mp4 extension).
    let mut sink_attrs: Option<IMFAttributes> = None;
    MFCreateAttributes(&mut sink_attrs, 1).map_err(|e| format!("sink attrs: {e:?}"))?;
    if let Some(a) = &sink_attrs {
        a.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1).ok();
    }

    let writer = MFCreateSinkWriterFromURL(PCWSTR(out_url.as_ptr()), None, sink_attrs.as_ref())
        .map_err(|e| format!("MFCreateSinkWriterFromURL: {e:?}"))?;

    // Configure each selected stream. For a `MFCreateSinkWriterFromURL`-based
    // transcode (no separate transcode sink in windows-rs 0.58) we give the
    // sink writer the desired ENCODED type via SetInputMediaType; the writer's
    // MFT inserts the H.264/AAC encoder and reads the source's native frames.
    for &(stidx, is_video) in &stream_ids {
        let in_type = reader.GetCurrentMediaType(stidx).map_err(|e| format!("GetCurrentMediaType({stidx}): {e:?}"))?;
        let out_type = make_output_type(&in_type, is_video)?;

        // Sink writer input stream index == source stream index by default.
        writer
            .SetInputMediaType(stidx, &out_type, None)
            .map_err(|e| format!("SetInputMediaType({stidx}): {e:?}"))?;
    }

    writer.BeginWriting().map_err(|e| format!("BeginWriting: {e:?}"))?;

    // Read samples within the window and write them to the matching stream.
    let mut started = false;
    let mut saw_end = false;
    while !saw_end {
        let mut actual_stream: u32 = 0;
        let mut flags: u32 = 0;
        let mut ts: i64 = 0;
        let mut sample: Option<IMFSample> = None;
        if reader
            .ReadSample(
                MF_SOURCE_READER_ANY_STREAM.0 as u32,
                0,
                Some(&mut actual_stream),
                Some(&mut flags),
                Some(&mut ts),
                Some(&mut sample),
            )
            .is_err()
        {
            break;
        }

        if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
            saw_end = true;
        }
        if flags & MF_SOURCE_READERF_STREAMTICK.0 as u32 != 0 {
            continue;
        }

        if let Some(s) = &sample {
            if ts >= start_hns {
                started = true;
            }
            if started {
                if end_hns > 0 && ts > end_hns {
                    break;
                }
                writer
                    .WriteSample(actual_stream, Some(s))
                    .map_err(|e| format!("WriteSample({actual_stream}): {e:?}"))?;
            }
        } else if started && end_hns > 0 && ts > end_hns {
            saw_end = true;
        }
    }

    writer.Finalize().map_err(|e| format!("Finalize: {e:?}"))?;
    Ok(())
}

unsafe fn mt_is(mt: &IMFMediaType, expected: windows::core::GUID) -> Result<bool, String> {
    let guid = mt
        .GetGUID(&MF_MT_MAJOR_TYPE)
        .map_err(|e| format!("GetGUID major: {e:?}"))?;
    Ok(guid == expected)
}

unsafe fn make_output_type(in_type: &IMFMediaType, is_video: bool) -> Result<IMFMediaType, String> {
    let out = MFCreateMediaType().map_err(|e| format!("MFCreateMediaType: {e:?}"))?;

    if is_video {
        out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .map_err(|e| format!("out major: {e:?}"))?;
        out.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)
            .map_err(|e| format!("out subtype: {e:?}"))?;

        let frame_size = in_type.GetUINT64(&MF_MT_FRAME_SIZE).unwrap_or(pack_ratio(1920, 1080));
        let frame_rate = in_type.GetUINT64(&MF_MT_FRAME_RATE).unwrap_or(pack_ratio(30, 1));

        out.SetUINT64(&MF_MT_FRAME_SIZE, frame_size)
            .map_err(|e| format!("out frame: {e:?}"))?;
        out.SetUINT64(&MF_MT_FRAME_RATE, frame_rate)
            .map_err(|e| format!("out fps: {e:?}"))?;
        out.SetUINT32(&MF_MT_AVG_BITRATE, VIDEO_BITRATE)
            .map_err(|e| format!("out vbit: {e:?}"))?;
    } else {
        out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)
            .map_err(|e| format!("out major: {e:?}"))?;
        out.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC)
            .map_err(|e| format!("out subtype: {e:?}"))?;

        let nchans = in_type.GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS).unwrap_or(2).max(1);
        let samples = in_type.GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND).unwrap_or(48000).max(1);
        let bits = in_type.GetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE).unwrap_or(16);

        out.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, nchans).map_err(|e| format!("out chan: {e:?}"))?;
        out.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, samples).map_err(|e| format!("out srate: {e:?}"))?;
        out.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, bits).map_err(|e| format!("out bits: {e:?}"))?;
        out.SetUINT32(&MF_MT_AVG_BITRATE, AUDIO_BITRATE).map_err(|e| format!("out abit: {e:?}"))?;
        out.SetUINT32(&MF_MT_AAC_PAYLOAD_TYPE, 0).map_err(|e| format!("out aacpt: {e:?}"))?;
    }
    Ok(out)
}

fn pack_ratio(num: u32, den: u32) -> u64 {
    ((num as u64) << 32) | (den as u64)
}

fn to_wide_url(p: &str) -> Result<Vec<u16>, String> {
    Ok(p.encode_utf16().collect())
}

/// Extract a single frame (at `at_sec` into the video) from a finalized MP4 and
/// save it as a JPEG thumbnail. Uses the Source Reader with an RGB32 output
/// type so the H.264 stream is decoded to uncompressed pixels, which we then
/// encode with the `image` crate.
pub fn extract_thumbnail(in_path: &str, out_path: &str, at_sec: f64) -> Result<(), String> {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            return Err(format!("CoInitializeEx: {hr:?}"));
        }
        let result = extract_thumbnail_inner(in_path, out_path, at_sec);
        CoUninitialize();
        result
    }
}

unsafe fn extract_thumbnail_inner(in_path: &str, out_path: &str, at_sec: f64) -> Result<(), String> {
    if std::path::Path::new(out_path).exists() {
        let _ = std::fs::remove_file(out_path);
    }

    let in_url = to_wide_url(in_path)?;

    let mut attrs: Option<IMFAttributes> = None;
    MFCreateAttributes(&mut attrs, 1).map_err(|e| format!("attrs: {e:?}"))?;
    if let Some(a) = &attrs {
        a.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1).ok();
    }

    let reader = MFCreateSourceReaderFromURL(PCWSTR(in_url.as_ptr()), attrs.as_ref())
        .map_err(|e| format!("MFCreateSourceReaderFromURL: {e:?}"))?;

    // Find the first video stream.
    let mut video_idx: Option<u32> = None;
    for idx in 0..64u32 {
        match reader.GetCurrentMediaType(idx) {
            Ok(mt) => {
                if mt_is(&mt, MFMediaType_Video)? {
                    video_idx = Some(idx);
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let video_idx = video_idx.ok_or("no video stream")?;

    // Request decoded RGB32 so we can dump pixels.
    let rgb = MFCreateMediaType().map_err(|e| format!("mt: {e:?}"))?;
    rgb.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
        .map_err(|e| format!("major: {e:?}"))?;
    rgb.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)
        .map_err(|e| format!("subtype: {e:?}"))?;
    reader
        .SetCurrentMediaType(video_idx, None, &rgb)
        .map_err(|e| format!("SetCurrentMediaType: {e:?}"))?;

    // Actual decoded dimensions + pixel format.
    let cur = reader
        .GetCurrentMediaType(video_idx)
        .map_err(|e| format!("GetCurrentMediaType: {e:?}"))?;
    let frame_size = cur
        .GetUINT64(&MF_MT_FRAME_SIZE)
        .unwrap_or(pack_ratio(1920, 1080));
    let w = (frame_size >> 32) as usize;
    let h = (frame_size & 0xFFFF_FFFF) as usize;

    let target_hns = (at_sec * 10_000_000.0) as i64;
    let mut saved = false;
    let mut saw_end = false;
    while !saw_end {
        let mut flags: u32 = 0;
        let mut ts: i64 = 0;
        let mut sample: Option<IMFSample> = None;
        if reader
            .ReadSample(video_idx, 0, None, Some(&mut flags), Some(&mut ts), Some(&mut sample))
            .is_err()
        {
            break;
        }
        if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
            saw_end = true;
        }
        if let Some(s) = &sample {
            if ts >= target_hns || saw_end {
                if let Ok(buf) = s.ConvertToContiguousBuffer() {
                    let mut ptr: *mut u8 = std::ptr::null_mut();
                    let mut len: u32 = 0;
                    if buf.Lock(&mut ptr, Some(&mut len), None).is_ok() && !ptr.is_null() {
                        let bytes = std::slice::from_raw_parts(ptr, len as usize);
                        if save_rgb32_jpeg(bytes, w, h, out_path) {
                            saved = true;
                        }
                    }
                }
                break;
            }
        }
    }
    if saved { Ok(()) } else { Err("no frame captured".into()) }
}

/// Convert an MF RGB32 buffer (BGRA byte order, rows padded to 4-byte stride)
/// to a JPEG file. Returns true on success.
fn save_rgb32_jpeg(bytes: &[u8], w: usize, h: usize, out_path: &str) -> bool {
    if w == 0 || h == 0 || w > 8192 || h > 8192 {
        return false;
    }
    let stride = (w * 4).min(bytes.len());
    let mut rgb = Vec::with_capacity(w * h * 3);
    for row in 0..h {
        let base = row * stride;
        for col in 0..w {
            let i = base + col * 4;
            if i + 3 < bytes.len() {
                rgb.push(bytes[i + 2]); // R
                rgb.push(bytes[i + 1]); // G
                rgb.push(bytes[i]); // B
            }
        }
    }
    let Some(img) = image::RgbImage::from_raw(w as u32, h as u32, rgb) else {
        return false;
    };
    img.save(out_path).is_ok()
}
