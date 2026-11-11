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

// Every field is optional: whatever is missing is left out (or shown as an empty box), never filled in.
export interface EvidenceInput {
  parcel?: string;
  status?: string; // the parcel's Lost status, e.g. FMHub_LHTransported
  lt?: string; // LT number of the shuttle trip
  cctvTime?: string | null; // HH:MM:SS read by the user from the CCTV clock
  fmsTime?: string | null; // HH:MM:SS of the status above (FMHub_LHPacking when no status)
  frame?: CanvasImageSource & { width: number; height: number };
  shapes: Shape[];
  fms?: ImageBitmap;
  point?: Point; // in FMS image pixels
}

export async function ensureFonts(): Promise<void> {
  await Promise.all([document.fonts.load(`700 38px ${FONT}`, 'หลักฐาน'), document.fonts.load(`400 20px ${FONT}`, 'หลักฐาน')]);
}

// The FMS status whose time is compared with CCTV; FMHub_LHPacking unless one is chosen.
export function statusName(status?: string): string {
  return status || 'FMHub_LHPacking';
}

export function headerText(parcel?: string, status?: string, lt?: string): string {
  return ['หลักฐาน CCTV', parcel, lt && `LT: ${lt}`, status && `สถานะ Lost: ${status}`, 'ยิงขึ้นรถ Shuttle แล้ว']
    .filter(Boolean)
    .join(' | ');
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
  const header = headerText(inp.parcel, inp.status, inp.lt);
  fitText(ctx, header, 38, W - PAD * 2);
  ctx.fillText(header, PAD, HEADER_H / 2 + 2);

  // Left: CCTV frame + annotations, fitted into 1200 x 675 (top-left aligned)
  if (inp.frame) {
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
  } else {
    emptyBox(ctx, PAD, IMG_TOP, LEFT_W, IMG_H, 'ไม่มีภาพ CCTV');
  }

  // Right: FMS screenshot fitted into 900 x 675 (top-left aligned)
  let ms = 0;
  if (inp.fms) {
    ms = Math.min(RIGHT_W / inp.fms.width, IMG_H / inp.fms.height);
    const mw = inp.fms.width * ms;
    const mh = inp.fms.height * ms;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(inp.fms, RIGHT_X, IMG_TOP, mw, mh);
    ctx.strokeStyle = '#d0d0d0';
    ctx.lineWidth = 1;
    ctx.strokeRect(RIGHT_X + 0.5, IMG_TOP + 0.5, mw - 1, mh - 1);
  } else {
    emptyBox(ctx, RIGHT_X, IMG_TOP, RIGHT_W, IMG_H, 'ไม่มีภาพ FMS');
  }

  // Labels: a missing time is left out; the match note needs both times.
  const match = inp.cctvTime && inp.fmsTime ? (inp.cctvTime === inp.fmsTime ? ' (ตรงกับ CCTV)' : ' (ใกล้เคียง CCTV)') : '';
  label(ctx, ['CCTV', inp.cctvTime, 'ยิงพัสดุขึ้นรถ Shuttle'].filter(Boolean).join(' '), PAD, LEFT_W);
  const fmsLabelW = label(ctx, ['FMS', statusName(inp.status), inp.fmsTime].filter(Boolean).join(' ') + match, RIGHT_X, RIGHT_W);

  // Arrow from the FMS label up to the clicked status row
  if (inp.fms && inp.point) {
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

function emptyBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string): void {
  ctx.save();
  ctx.fillStyle = '#f4f5f7';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#c9ced6';
  ctx.setLineDash([12, 8]);
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = '#98a2b3';
  ctx.font = `700 32px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2);
  ctx.restore();
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
