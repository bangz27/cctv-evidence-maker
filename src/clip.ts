import { drawShapes, type Shape } from './annotate';
import { FONT, ORANGE } from './evidence';
import type { VideoController } from './video';

const OUT_W = 1280;
const OUT_H = 720;
const BAR_H = 56;
// ~1.1 Mbps video keeps a 1-minute clip around 8 MB.
const VIDEO_BPS = 1_100_000;

export interface ClipFormat {
  mime: string;
  ext: 'mp4' | 'webm';
}

export function pickFormat(): ClipFormat | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates: ClipFormat[] = [
    { mime: 'video/mp4;codecs=avc1.42E01F', ext: 'mp4' },
    { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? null;
}

export interface ClipOptions {
  video: VideoController;
  start: number;
  end: number;
  shapes: Shape[];
  barText: string;
  onProgress?: (fraction: number) => void;
}

// Plays [start, end] of the video in real time onto a 1280x720 canvas and records it.
// The video frame is letterboxed above the text bar, so nothing in the original frame is covered.
export async function recordClip(o: ClipOptions): Promise<{ blob: Blob; format: ClipFormat }> {
  const format = pickFormat();
  if (!format) throw new Error('เบราว์เซอร์นี้อัดคลิปไม่ได้ (ไม่รองรับ MediaRecorder)');
  const el = o.video.el;
  const canvas = document.createElement('canvas');
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext('2d')!;

  const vw = o.video.width;
  const vh = o.video.height;
  const s = Math.min(OUT_W / vw, (OUT_H - BAR_H) / vh);
  const dw = vw * s;
  const dh = vh * s;
  const dx = (OUT_W - dw) / 2;
  const dy = (OUT_H - BAR_H - dh) / 2;

  const draw = () => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    ctx.drawImage(el, dx, dy, dw, dh);
    ctx.save();
    ctx.translate(dx, dy);
    ctx.scale(s, s);
    drawShapes(ctx, o.shapes, vh);
    ctx.restore();
    ctx.fillStyle = '#111';
    ctx.fillRect(0, OUT_H - BAR_H, OUT_W, BAR_H);
    ctx.fillStyle = ORANGE;
    ctx.fillRect(0, OUT_H - BAR_H, 10, BAR_H);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    let size = 28;
    ctx.font = `700 ${size}px ${FONT}`;
    while (size > 14 && ctx.measureText(o.barText).width > OUT_W - 40) {
      size--;
      ctx.font = `700 ${size}px ${FONT}`;
    }
    ctx.fillText(o.barText, OUT_W / 2, OUT_H - BAR_H / 2 + 2);
    ctx.textAlign = 'left';
  };

  el.pause();
  el.muted = true;
  el.playbackRate = 1;
  await o.video.seek(o.start);
  draw();

  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: VIDEO_BPS });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));

  const total = Math.max(0.1, o.end - o.start);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.pause();
    rec.stop();
    stream.getTracks().forEach((t) => t.stop());
  };
  // A timer, not rVFC/rAF: those stop firing whenever the window isn't being painted
  // (covered or minimised), which silently produced 1-frame clips.
  const tick = () => {
    if (done) return;
    draw();
    o.onProgress?.(Math.min(1, (el.currentTime - o.start) / total));
    if (el.currentTime >= o.end || el.ended) finish();
  };
  el.addEventListener('ended', finish, { once: true });

  rec.start(1000);
  const timer = setInterval(tick, 1000 / 30);
  await el.play();
  await stopped;
  clearInterval(timer);
  el.removeEventListener('ended', finish);
  o.onProgress?.(1);
  return { blob: new Blob(chunks, { type: format.mime.split(';')[0] }), format };
}
