/* Highlight clip extraction via Windows Media Foundation transcode.
   Reads the source MP4 with a Source Reader, re-encodes the [start_sec,
   end_sec] window to H.264/AAC through a Sink Writer, and writes a fresh,
   small clip file. Self-contained (no FFmpeg / external binaries). */

use windows::core::PCWSTR;
use windows::Win32::Foundation::{FALSE, RPC_E_CHANGED_MODE, TRUE};
use windows::Win32::Media::MediaFoundation::{
    MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING,
    MF_MT_AAC_PAYLOAD_TYPE, MF_MT_AUDIO_BITS_PER_SAMPLE,
    MF_MT_AUDIO_BLOCK_ALIGNMENT, MF_MT_AUDIO_NUM_CHANNELS, MF_MT_AUDIO_SAMPLES_PER_SECOND,
    MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE,
    MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_SOURCE_READERF_ENDOFSTREAM,
    MF_SOURCE_READERF_STREAMTICK, MF_SOURCE_READER_ANY_STREAM, MFAudioFormat_AAC, MFAudioFormat_PCM,
    MFCreateAttributes, MFCreateMediaType, MFCreateSinkWriterFromURL, MFCreateSourceReaderFromURL,
    MFMediaType_Audio, MFMediaType_Video, MFShutdown, MFStartup, MFVideoFormat_H264,
    MFVideoFormat_NV12, MFVideoFormat_RGB32, MFVideoInterlace_Progressive, MF_VERSION, MFSTARTUP_FULL,
    IMFAttributes, IMFMediaType, IMFSample,
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
        // Without MFStartup the platform reports MF_E_SHUTDOWN (0xC00D3E85)
        // and the source/sink objects fail to create, which made every clip
        // silently fall back to a full VOD copy.
        let mf = MFStartup(MF_VERSION, MFSTARTUP_FULL);
        if mf.is_err() {
            return Err(format!("MFStartup: {mf:?}"));
        }
        let result = cut_highlight_inner(in_path, out_path, start_sec, end_sec);
        let _ = MFShutdown();
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

    let mut stream_map: Vec<(u32, u32)> = Vec::new(); // (source index, sink index)
    // Ask the reader for DECODED samples (NV12 / PCM) and let the Sink Writer
    // insert the H.264 / AAC encoders: the encoders generate the SPS/PPS
    // headers the MP4 sink needs. Passing the source's compressed samples
    // through directly leaves the sink unable to produce its file headers and
    // Finalize fails with 0xC00D4A45 (MF_E_SINK_HEADERS_NOT_FOUND).
    let mut ordered: Vec<(u32, bool)> = stream_ids.clone();
    ordered.sort_by_key(|(_, is_video)| !*is_video);
    for &(stidx, is_video) in &ordered {
        let native = reader.GetCurrentMediaType(stidx).map_err(|e| format!("GetCurrentMediaType({stidx}): {e:?}"))?;
        let decoded = make_decoded_input_type(&native, is_video)?;
        reader
            .SetCurrentMediaType(stidx, None, &decoded)
            .map_err(|e| format!("SetCurrentMediaType({stidx}): {e:?}"))?;
        let decoded = reader.GetCurrentMediaType(stidx).map_err(|e| format!("GetCurrentMediaType({stidx}): {e:?}"))?;
        let encoded = make_output_type(&decoded, is_video)?;

        // Sink stream indexes are NOT the same as source indexes: ask the sink
        // writer to create each stream and use the index it returns.
        let sink_idx = writer
            .AddStream(&encoded)
            .map_err(|e| format!("AddStream({stidx}): {e:?}"))?;
        writer
            .SetInputMediaType(sink_idx, &decoded, None)
            .map_err(|e| format!("SetInputMediaType({stidx}->{sink_idx}): {e:?}"))?;
        stream_map.push((stidx, sink_idx));
    }

    let sink_for = |src_idx: u32| -> Option<u32> {
        stream_map.iter().find(|(s, _)| *s == src_idx).map(|(_, si)| *si)
    };

    writer.BeginWriting().map_err(|e| format!("BeginWriting: {e:?}"))?;

    // Fast-forward the source reader to just before the window instead of
    // decoding the whole VOD from frame 0. Without this every cut on a ~20 min
    // recording had to decode the full file up to the highlight first — that
    // was the "clip takes forever / share never shows a link" slowness. If the
    // source cannot seek we just fall back to the decode-from-start behavior.
    {
        let seek_at = (start_hns - 20_000_000).max(0); // 2s lead-in for the keyframe
        let mf_time_format = windows::core::GUID::from_u128(0x0F7A0A6E_F007_41D9_8AE4_6D90B4AEE6F4);
        let pos = windows::core::PROPVARIANT::from(seek_at);
        let _ = reader.SetCurrentPosition(&mf_time_format, &pos);
    }

    // Read samples within the window and write them to the matching stream.
    let mut started = false;
    let mut saw_end = false;
    while !saw_end {
        let mut actual_stream: u32 = 0;
        let mut flags: u32 = 0;
        let mut ts: i64 = 0;
        let mut sample: Option<IMFSample> = None;
        if let Err(e) = reader.ReadSample(
                MF_SOURCE_READER_ANY_STREAM.0 as u32,
                0,
                Some(&mut actual_stream),
                Some(&mut flags),
                Some(&mut ts),
                Some(&mut sample),
            )
        {
            return Err(format!("ReadSample: {e:?}"));
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
                if let Some(sink_idx) = sink_for(actual_stream) {
                    // Rebase presentation timestamps onto the window start so
                    // the clip begins at t=0 instead of carrying the source's
                    // absolute times (which leaves a blank gap in the file).
                    let t = (ts - start_hns).max(0);
                    s.SetSampleTime(t).map_err(|e| format!("SetSampleTime({sink_idx}): {e:?}"))?;
                    writer
                        .WriteSample(sink_idx, Some(s))
                        .map_err(|e| format!("WriteSample({sink_idx}): {e:?}"))?;
                }
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

/// Build the DECODED type (NV12 / PCM) the Source Reader should hand us so the
/// Sink Writer can chain its H.264 / AAC encoders (which produce the file
/// headers Finalize requires).
unsafe fn make_decoded_input_type(native: &IMFMediaType, is_video: bool) -> Result<IMFMediaType, String> {
    let out = MFCreateMediaType().map_err(|e| format!("MFCreateMediaType: {e:?}"))?;

    if is_video {
        out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
            .map_err(|e| format!("in major: {e:?}"))?;
        out.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)
            .map_err(|e| format!("in subtype: {e:?}"))?;
        let frame_size = native.GetUINT64(&MF_MT_FRAME_SIZE).unwrap_or(pack_ratio(1920, 1080));
        let frame_rate = native.GetUINT64(&MF_MT_FRAME_RATE).unwrap_or(pack_ratio(30, 1));
        out.SetUINT64(&MF_MT_FRAME_SIZE, frame_size).map_err(|e| format!("in frame: {e:?}"))?;
        out.SetUINT64(&MF_MT_FRAME_RATE, frame_rate).map_err(|e| format!("in fps: {e:?}"))?;
        out.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
            .map_err(|e| format!("in interlace: {e:?}"))?;
    } else {
        out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)
            .map_err(|e| format!("in major: {e:?}"))?;
        out.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM)
            .map_err(|e| format!("in subtype: {e:?}"))?;
        let nchans = native.GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS).unwrap_or(2).max(1);
        let samples = native.GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND).unwrap_or(48000).max(1);
        let bits = 16u32;
        out.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, nchans).map_err(|e| format!("in chan: {e:?}"))?;
        out.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, samples).map_err(|e| format!("in srate: {e:?}"))?;
        out.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, bits).map_err(|e| format!("in bits: {e:?}"))?;
        out.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, bits / 8 * nchans).map_err(|e| format!("in align: {e:?}"))?;
    }
    Ok(out)
}

fn to_wide_url(p: &str) -> Result<Vec<u16>, String> {
    // PCWSTR requires a null-terminated UTF-16 string; encode_utf16 alone
    // does NOT append the terminator, which made every MF URL read garbage
    // (0x80070002 / "file not found") and silently broke clip cutting.
    let mut out: Vec<u16> = p.encode_utf16().collect();
    out.push(0);
    Ok(out)
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
        let mf = MFStartup(MF_VERSION, MFSTARTUP_FULL);
        if mf.is_err() {
            return Err(format!("MFStartup: {mf:?}"));
        }
        let result = extract_thumbnail_inner(in_path, out_path, at_sec);
        let _ = MFShutdown();
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
    MFCreateAttributes(&mut attrs, 2).map_err(|e| format!("attrs: {e:?}"))?;
    if let Some(a) = &attrs {
        a.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1).ok();
        // Allow the source reader to insert the video processor so NV12 -> RGB32
        // conversion works even when the H.264 decoder can't emit RGB32 itself.
        a.SetUINT32(&MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1).ok();
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

    let native = reader
        .GetCurrentMediaType(video_idx)
        .map_err(|e| format!("GetCurrentMediaType: {e:?}"))?;

    // Request decoded RGB32 so we can dump pixels. The type MUST be complete
    // (frame size + frame rate + interlace), otherwise MF rejects it with
    // MF_E_INVALIDMEDIATYPE (0xC00D36B4) and every thumbnail silently fails.
    let frame_size = native.GetUINT64(&MF_MT_FRAME_SIZE).unwrap_or(pack_ratio(1920, 1080));
    let frame_rate = native.GetUINT64(&MF_MT_FRAME_RATE).unwrap_or(pack_ratio(30, 1));
    let rgb = MFCreateMediaType().map_err(|e| format!("mt: {e:?}"))?;
    rgb.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
        .map_err(|e| format!("major: {e:?}"))?;
    rgb.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)
        .map_err(|e| format!("subtype: {e:?}"))?;
    rgb.SetUINT64(&MF_MT_FRAME_SIZE, frame_size)
        .map_err(|e| format!("frame: {e:?}"))?;
    rgb.SetUINT64(&MF_MT_FRAME_RATE, frame_rate)
        .map_err(|e| format!("fps: {e:?}"))?;
    rgb.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
        .map_err(|e| format!("interlace: {e:?}"))?;
    reader
        .SetCurrentMediaType(video_idx, None, &rgb)
        .map_err(|e| format!("SetCurrentMediaType: {e:?}"))?;

    // Actual decoded dimensions + pixel format.
    let cur = reader
        .GetCurrentMediaType(video_idx)
        .map_err(|e| format!("GetCurrentMediaType: {e:?}"))?;
    let cur_size = cur
        .GetUINT64(&MF_MT_FRAME_SIZE)
        .unwrap_or(pack_ratio(1920, 1080));
    let w = (cur_size >> 32) as usize;
    let h = (cur_size & 0xFFFF_FFFF) as usize;

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
