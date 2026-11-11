import { createFile, DataStream, Endianness, MP4BoxBuffer, type Movie, type Sample } from 'mp4box';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Shape } from './annotate';
import { drawClipFrame, OUT_H, OUT_W, VIDEO_BPS } from './clip';

// Fast clip path: demux the opened MP4 (mp4box), decode only the needed range (WebCodecs
// VideoDecoder), draw shapes + text bar, encode H.264 (VideoEncoder) and mux to MP4.
// Nothing is played, so it runs faster than real time and keeps working in a background tab.
// Throws FastClipUnavailable when the file or browser can't take this path; the caller then
// falls back to real-time recording.

export class FastClipUnavailable extends Error {}

export interface FastClipOptions {
  file: Blob;
  start: number; // seconds, as the <video> element counts them
  end: number;
  srcW: number;
  srcH: number;
  shapes: Shape[];
  barText: string;
  onProgress?: (fraction: number) => void;
}

const CHUNK = 4 << 20; // read the file 4 MB at a time
const ENCODER_CODECS = ['avc1.42001f', 'avc1.4d001f', 'avc1.640028'];
const QUEUE_MAX = 16;

export async function renderClipFast(o: FastClipOptions): Promise<Blob> {
  if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined') {
    throw new FastClipUnavailable('no WebCodecs');
  }
  const head = new Uint8Array(await o.file.slice(4, 8).arrayBuffer());
  if (String.fromCharCode(...head) !== 'ftyp') throw new FastClipUnavailable('not an MP4 file');

  // --- read the header (the moov box may sit at the end of the file) ---
  const mp4 = createFile();
  let info: Movie | null = null;
  let demuxError = '';
  mp4.onReady = (i) => (info = i);
  mp4.onError = (_m, msg) => (demuxError = msg);
  let pos = 0;
  for (let guard = 0; !info; guard++) {
    if (demuxError || pos >= o.file.size || guard > 1000) throw new FastClipUnavailable(`demux: ${demuxError || 'no moov'}`);
    const next = mp4.appendBuffer(await readAt(o.file, pos), pos + CHUNK >= o.file.size);
    pos = next > pos ? next : pos + CHUNK;
  }
  const movie = info as Movie;
  const track = movie.videoTracks[0];
  if (!track?.video) throw new FastClipUnavailable('no video track');

  // --- decoder / encoder setup ---
  const decoderConfig: VideoDecoderConfig = {
    codec: track.codec,
    codedWidth: track.video.width,
    codedHeight: track.video.height,
    description: codecDescription(mp4, track.id),
  };
  if (!(await VideoDecoder.isConfigSupported(decoderConfig)).supported) throw new FastClipUnavailable(`decoder: ${track.codec}`);
  const fps = track.nb_samples / (track.duration / track.timescale) || 25;
  let encoderConfig: VideoEncoderConfig | null = null;
  // Hardware encoder first, then software in its fast "realtime" mode (about 2x the default
  // speed for the same file size at this bitrate).
  const modes: Partial<VideoEncoderConfig>[] = [{ latencyMode: 'realtime' }, {}];
  search: for (const mode of modes) {
    for (const codec of ENCODER_CODECS) {
      const cfg: VideoEncoderConfig = { codec, width: OUT_W, height: OUT_H, bitrate: VIDEO_BPS, framerate: fps, ...mode };
      if ((await VideoEncoder.isConfigSupported(cfg)).supported) {
        encoderConfig = cfg;
        break search;
      }
    }
  }
  if (!encoderConfig) throw new FastClipUnavailable('encoder');

  // The <video> element's time 0 is the first presented frame; samples count from their own cts.
  const firstCts = Math.min(...mp4.getTrackSamplesInfo(track.id).slice(0, 32).map((s) => s.cts));
  const toUs = (cts: number) => ((cts - firstCts) * 1e6) / track.timescale;
  const startUs = o.start * 1e6;
  const endUs = o.end * 1e6;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: OUT_W, height: OUT_H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let failure: Error | null = null;
  const fail = (e: unknown) => (failure ??= e instanceof Error ? e : new Error(String(e)));
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: fail });
  encoder.configure(encoderConfig);

  const canvas = document.createElement('canvas');
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext('2d')!;
  let encoded = 0;
  const keyEvery = Math.max(1, Math.round(fps * 2));
  const decoder = new VideoDecoder({
    output: (frame) => {
      const ts = frame.timestamp;
      if (ts < startUs - 1000 || ts > endUs || failure) return frame.close();
      drawClipFrame(ctx, frame, o.srcW, o.srcH, o.shapes, o.barText);
      frame.close();
      const out = new VideoFrame(canvas, { timestamp: ts - startUs, duration: 1e6 / fps });
      encoder.encode(out, { keyFrame: encoded % keyEvery === 0 });
      out.close();
      encoded++;
      o.onProgress?.(Math.min(1, (ts - startUs) / (endUs - startUs)));
    },
    error: fail,
  });
  decoder.configure(decoderConfig);

  // --- extract samples from the key frame at/before start until past end ---
  let started = false;
  let pastEnd = false;
  mp4.onSamples = (id, _user, samples: Sample[]) => {
    for (const s of samples) {
      if (pastEnd || !s.data) continue;
      if (!started && !s.is_sync) continue; // decoding must begin on a key frame
      started = true;
      const ts = toUs(s.cts);
      // B-frames arrive out of order: keep feeding a little past the end.
      if (toUs(s.dts) > endUs + 1e6) {
        pastEnd = true;
        continue;
      }
      decoder.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: ts, duration: (s.duration * 1e6) / track.timescale, data: s.data }));
      mp4.releaseUsedSamples(id, s.number);
    }
  };
  mp4.setExtractionOptions(track.id, null, { nbSamples: 60 });
  const seekTo = mp4.seek(Math.max(0, o.start + firstCts / track.timescale), true);
  mp4.start();
  pos = seekTo.offset;
  while (!pastEnd && !failure && pos < o.file.size) {
    const next = mp4.appendBuffer(await readAt(o.file, pos), pos + CHUNK >= o.file.size);
    pos = next > pos ? next : pos + CHUNK;
    // Back-pressure: don't race ahead of the decoder/encoder.
    while (!failure && (decoder.decodeQueueSize > QUEUE_MAX || encoder.encodeQueueSize > QUEUE_MAX)) {
      await dequeued(decoder.decodeQueueSize > QUEUE_MAX ? decoder : encoder);
    }
  }
  mp4.flush();
  await decoder.flush().catch(fail);
  await encoder.flush().catch(fail);
  decoder.close();
  encoder.close();
  if (failure) throw failure;
  if (!encoded) throw new FastClipUnavailable('no frames decoded in range');
  muxer.finalize();
  o.onProgress?.(1);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

async function readAt(file: Blob, pos: number): Promise<MP4BoxBuffer> {
  return MP4BoxBuffer.fromArrayBuffer(await file.slice(pos, pos + CHUNK).arrayBuffer(), pos);
}

// avcC / hvcC / vpcC / av1C box payload, which WebCodecs takes as `description`.
function codecDescription(mp4: ReturnType<typeof createFile>, trackId: number): Uint8Array | undefined {
  const entry = mp4.getTrackById(trackId).mdia.minf.stbl.stsd.entries[0] as unknown as Record<string, { write(s: unknown): void } | undefined>;
  const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
  if (!box) return undefined;
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  return new Uint8Array(stream.buffer as ArrayBuffer, 8); // skip the box header
}

// Resolves when the decoder/encoder takes the next item off its queue. Event-driven, so it
// isn't slowed down by background-tab timer throttling.
function dequeued(codec: VideoDecoder | VideoEncoder): Promise<void> {
  return new Promise((resolve) => codec.addEventListener('dequeue', () => resolve(), { once: true }));
}
