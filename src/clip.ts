import { drawShapes, type Shape } from './annotate';
import { FONT, ORANGE } from './evidence';
import type { VideoController } from './video';

export const OUT_W = 1280;
export const OUT_H = 720;
const BAR_H = 56;
// ~1.1 Mbps video keeps a 1-minute clip around 8 MB.
export const VIDEO_BPS = 1_100_000;

// One output frame: the source letterboxed above the text bar (nothing in the original
// frame is covered), with the shapes drawn on top. srcW/srcH = the shapes' coordinate space.
export function drawClipFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  shapes: Shape[],
  barText: string,
): void {
  const s = Math.min(OUT_W / srcW, (OUT_H - BAR_H) / srcH);
  const dw = srcW * s;
  const dh = srcH * s;
  const dx = (OUT_W - dw) / 2;
  const dy = (OUT_H - BAR_H - dh) / 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, OUT_W, OUT_H);
  ctx.drawImage(source, dx, dy, dw, dh);
  ctx.save();
  ctx.translate(dx, dy);
  ctx.scale(s, s);
  drawShapes(ctx, shapes, srcH);
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
  while (size > 14 && ctx.measureText(barText).width > OUT_W - 40) {
    size--;
    ctx.font = `700 ${size}px ${FONT}`;
  }
  ctx.fillText(barText, OUT_W / 2, OUT_H - BAR_H / 2 + 2);
  ctx.textAlign = 'left';
}

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

// Fallback path: plays [start, end] of the video in real time onto a 1280x720 canvas and
// records it with MediaRecorder. Used when the fast path (fastclip.ts) can't handle the file.
export async function recordClip(o: ClipOptions): Promise<{ blob: Blob; format: ClipFormat }> {
  const format = pickFormat();
  if (!format) throw new Error('เบราว์เซอร์นี้อัดคลิปไม่ได้ (ไม่รองรับ MediaRecorder)');
  const el = o.video.el;
  const canvas = document.createElement('canvas');
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext('2d')!;
  const draw = () => drawClipFrame(ctx, el, o.video.width, o.video.height, o.shapes, o.barText);

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
  const blob = new Blob(chunks, { type: format.mime.split(';')[0] });
  // Happens when the tab was in the background the whole time: the browser drew no frames.
  if (!blob.size) throw new Error('อัดคลิปไม่สำเร็จ (ไม่ได้ภาพเลย) — เปิดหน้าเว็บนี้ค้างไว้ระหว่างอัด แล้วลองใหม่');
  return { blob, format };
}
