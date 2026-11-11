import type { Worker } from 'tesseract.js';
import type { Shape } from './annotate';
import { normalizeTime } from './time';

// Reads the DVR clock burned into the frame, inside the yellow box the user placed over it.
// tesseract.js is loaded on first use (its engine and English data come from a CDN).

let worker: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker, PSM } = await import('tesseract.js');
    const w = await createWorker('eng');
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789:-/. ' });
    return w;
  })().catch((err) => {
    worker = null; // allow a retry, e.g. after the network comes back
    throw new Error(`โหลดระบบอ่านตัวอักษรไม่ได้ (ต้องต่ออินเทอร์เน็ตครั้งแรก): ${(err as Error).message}`);
  });
  return worker;
}

// Crops the box, scales it up and turns it into black text on white, which is what the
// OCR engine reads best. DVR clocks are light text on a darker picture.
function prepare(source: CanvasImageSource, box: Shape): HTMLCanvasElement {
  const scale = Math.max(1, 64 / box.h);
  const c = document.createElement('canvas');
  c.width = Math.round(box.w * scale);
  c.height = Math.round(box.h * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const ink = v > 170 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = ink;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface ClockReading {
  time: string | null; // HH:MM:SS, or null when no clock time was found
  raw: string; // what the OCR saw, for the message shown to the user
}

export async function readClock(source: CanvasImageSource, box: Shape): Promise<ClockReading> {
  const w = await getWorker();
  const { data } = await w.recognize(prepare(source, box));
  const raw = data.text.trim();
  // The time is the last H:MM:SS on the line (the date comes first on most DVRs).
  const all = [...raw.matchAll(/(\d{1,2})\s*[:.]\s*(\d{2})\s*[:.]\s*(\d{2})/g)];
  const m = all[all.length - 1];
  return { time: m ? normalizeTime(`${m[1]}:${m[2]}:${m[3]}`) : null, raw };
}

export const toSeconds = (hms: string) => {
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};
