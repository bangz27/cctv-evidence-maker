import { drawShapes, RED, type Shape } from './annotate';

export const ORANGE = '#EE4D2D';
export const FONT = 'Sarabun, "Noto Sans Thai", sans-serif';

// Evidence image layout, matching the sheet used today (2160 x 855).
const W = 2160;
const H = 855;
const HEADER_H = 70;
const PAD = 20;
const LEFT_W = 1200;
const RIGHT_W = 900;
const IMG_TOP = HEADER_H + PAD; // 90
const IMG_H = 675; // 1200 x 675 = 16:9
const RIGHT_X = PAD + LEFT_W + PAD; // 1240
const LABEL_Y = IMG_TOP + IMG_H + 15; // 780
const LABEL_H = 56;

export interface Point {
  x: number;
  y: number;
}

export interface EvidenceInput {
  parcel: string;
  to: string;
  cctvTime: string; // HH:MM:SS read by the user from the CCTV clock
  fmsTime: string; // HH:MM:SS of FMHub_LHPacking
  frame: CanvasImageSource & { width: number; height: number };
  shapes: Shape[];
  fms: ImageBitmap;
  point?: Point; // in FMS image pixels
}

export async function ensureFonts(): Promise<void> {
  await Promise.all([document.fonts.load(`700 38px ${FONT}`, 'หลักฐาน'), document.fonts.load(`400 20px ${FONT}`, 'หลักฐาน')]);
}

export function headerText(parcel: string, to: string): string {
  return `หลักฐาน CCTV | ${parcel} | ${to} | ยิงขึ้นรถ Shuttle แล้ว`;
}

export function renderEvidence(inp: EvidenceInput): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = ORANGE;
  ctx.fillRect(0, 0, W, HEADER_H);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  fitText(ctx, headerText(inp.parcel, inp.to), 38, W - PAD * 2);
  ctx.fillText(headerText(inp.parcel, inp.to), PAD, HEADER_H / 2 + 2);

  // Left: CCTV frame + annotations, fitted into 1200 x 675 (top-left aligned)
  const fs = Math.min(LEFT_W / inp.frame.width, IMG_H / inp.frame.height);
  const fw = inp.frame.width * fs;
  const fh = inp.frame.height * fs;
  ctx.save();
  ctx.translate(PAD, IMG_TOP);
  ctx.beginPath();
  ctx.rect(0, 0, fw, fh);
  ctx.clip();
  ctx.drawImage(inp.frame, 0, 0, fw, fh);
  ctx.scale(fs, fs);
  drawShapes(ctx, inp.shapes, inp.frame.height);
  ctx.restore();

  // Right: FMS screenshot fitted into 900 x 675 (top-left aligned)
  const ms = Math.min(RIGHT_W / inp.fms.width, IMG_H / inp.fms.height);
  const mw = inp.fms.width * ms;
  const mh = inp.fms.height * ms;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(inp.fms, RIGHT_X, IMG_TOP, mw, mh);
  ctx.strokeStyle = '#d0d0d0';
  ctx.lineWidth = 1;
  ctx.strokeRect(RIGHT_X + 0.5, IMG_TOP + 0.5, mw - 1, mh - 1);

  // Labels
  const match = inp.cctvTime === inp.fmsTime ? 'ตรงกับ CCTV' : 'ใกล้เคียง CCTV';
  label(ctx, `CCTV ${inp.cctvTime} ยิงพัสดุขึ้นรถ Shuttle`, PAD, LEFT_W);
  const fmsLabelW = label(ctx, `FMS FMHub_LHPacking ${inp.fmsTime} (${match})`, RIGHT_X, RIGHT_W);

  // Arrow from the FMS label up to the clicked LHPacking row
  if (inp.point) {
    const tx = RIGHT_X + inp.point.x * ms;
    const ty = IMG_TOP + inp.point.y * ms;
    arrow(ctx, RIGHT_X + fmsLabelW * 0.6, LABEL_Y, tx, ty);
  }
  return c;
}

export function toJpeg(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('สร้าง JPG ไม่สำเร็จ'))), 'image/jpeg', 0.92),
  );
}

function fitText(ctx: CanvasRenderingContext2D, text: string, size: number, maxW: number): void {
  let s = size;
  ctx.font = `700 ${s}px ${FONT}`;
  while (s > 18 && ctx.measureText(text).width > maxW) {
    s -= 1;
    ctx.font = `700 ${s}px ${FONT}`;
  }
}

// Red label with white bold text; returns its width.
function label(ctx: CanvasRenderingContext2D, text: string, x: number, maxW: number): number {
  fitText(ctx, text, 30, maxW - 28);
  const w = Math.min(maxW, ctx.measureText(text).width + 28);
  ctx.fillStyle = RED;
  ctx.fillRect(x, LABEL_Y, w, LABEL_H);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 14, LABEL_Y + LABEL_H / 2 + 2);
  return w;
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  const head = 26;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const bx = x2 - Math.cos(ang) * head * 0.8;
  const by = y2 - Math.sin(ang) * head * 0.8;
  ctx.save();
  ctx.strokeStyle = RED;
  ctx.fillStyle = RED;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(ang - 0.4), y2 - head * Math.sin(ang - 0.4));
  ctx.lineTo(x2 - head * Math.cos(ang + 0.4), y2 - head * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
