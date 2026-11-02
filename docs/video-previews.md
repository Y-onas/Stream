# Automatic video card thumbnails

Each video card uses a frame from the actual video as its existing cover image,
visible before opening playback. It replaces the generic Habeshan HUB image when
extraction succeeds. The mobile cover stays full width above the title. There is
no separate preview below the information. Existing desktop dimensions and
playback routes are unchanged. No stock images or replacement videos are used.

## Source and extraction

The Node API runs FFmpeg against the existing authenticated Go HTTP Range stream.
This supports MP4/MOV and MKV/WebM through server decoders, including codecs a
particular browser cannot decode. A successful thumbnail does not imply that the
original codec is playable by every browser; the streaming implementation is
unchanged.

`GET /api/videos/:id/thumbnail` accepts only an existing catalogue key, behind the
same gateway/origin checks as playback. It returns JPEG (200), pending (202 with
Retry-After), or unavailable (404). HEAD never starts a generation job. Clients
cannot supply a URL, filename, timestamp, filter, command or Telegram peer/hash.

The browser starts extraction automatically when a video card nears the
viewport. It polls pending work and releases its image URL on unmount. Failed work keeps the
existing fallback and is held for five minutes before allowing another attempt.

FFmpeg has no Telegram credentials in its command arguments. It receives a random,
job-scoped loopback URL. This broker requests only finite authenticated byte
ranges from Go, refuses upstream responses that ignore Range, pins the source ETag
throughout a job to avoid mixing a replaced file's bytes, and enforces:

- One generation job at a time, at most 64 queued/running jobs, deduplicated by
  source key, filename, size and upload timestamp.
- At most 24 MiB of requested source payload and 48 chunk reads per job, with each
  chunk capped at 512 KiB. A chunk read permits up to four HTTP attempts for
  transient failures. Go may read aligned Telegram chunks surrounding those ranges.
- A 150-second job deadline; at most three 45-second extraction attempts. Transient
  upstream 502/503/504 responses have bounded retries within each read's deadline.
- Eight seconds of input per attempt, two sampled frames per second, at most one
  320×180 JPEG with its original proportions, capped at 256 KiB.

When duration is known, candidate timestamps come from 15%, 40% and 65% of duration
(capped at 90 seconds). Otherwise it tries 90, 30 and 5 seconds. Near-black,
near-white and low-entropy/blank frames are rejected before FFmpeg's histogram
thumbnail selector chooses among the remaining samples. This is a heuristic:
title sequences or loading graphics with image detail can still qualify. A file
without usable seek indexes may exceed the budget and retain its fallback rather
than download the full movie.

Only completed JPEGs are cached, in API memory: an LRU budget of 16 MiB, 30-minute
TTL. No video file or chunk is stored on VPS disk. Restarting the API regenerates
previews on demand. Existing dedicated artwork, if present, is preserved.

## Runtime dependency

Install FFmpeg on PATH or set the API process's `FFMPEG_PATH` to its executable.
The local `npm run runtime:api` wrapper also detects
`.tools/ffmpeg/bin/ffmpeg.exe` on Windows. The API Dockerfile installs FFmpeg, so
rebuild that image when deploying this change. Missing FFmpeg produces the
fallback, never a fake thumbnail. Existing runtime tokens remain server-side.

Run `npm test` for budget, deduplication, partial-response validation and endpoint
checks. With the real local runtime running, `node scripts/verify-thumbnails.mjs`
requests previews for the current catalogue and writes tiny images plus a status
summary under ignored `.local/qa/`. It does not download video files.

FFmpeg references: [HTTP protocol options](https://ffmpeg.org/ffmpeg-protocols.html#http),
[frame selection filters](https://ffmpeg.org/ffmpeg-filters.html#thumbnail),
[entropy filter implementation](https://ffmpeg.org/doxygen/7.1/vf__entropy_8c_source.html).
