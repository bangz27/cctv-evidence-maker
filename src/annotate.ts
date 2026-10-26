export const RED = '#E61E1E';
export const YELLOW = '#FFD600';

export type ShapeType = 'ellipse' | 'rect';
export type Tool = 'select' | ShapeType;

// Coordinates are in source-video pixels (e.g. 1920x1080), never screen pixels.
export interface Shape {
  type: ShapeType;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function defaultShapes(w: number, h: number): Shape[] {
  const s = h / 1080;
  return [
    { type: 'rect', x: 0, y: 58 * s, w: 560 * s, h: 46 * s },
    { type: 'ellipse', x: w * 0.62, y: h * 0.42, w: 420 * s, h: 400 * s },
  ];
}

// Draws shapes for a source of height srcH into ctx, already transformed to source coords.
// Line widths: ellipse 10px / rect 6px at 1080p, scaled with the source.
export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], srcH: number): void {
  const base = srcH / 1080;
  for (const sh of shapes) {
    ctx.save();
    if (sh.type === 'ellipse') {
      ctx.strokeStyle = RED;
      ctx.lineWidth = 10 * base;
      ctx.beginPath();
      ctx.ellipse(sh.x + sh.w / 2, sh.y + sh.h / 2, Math.abs(sh.w / 2), Math.abs(sh.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = YELLOW;
      ctx.lineWidth = 6 * base;
      const lw = ctx.lineWidth / 2;
      ctx.strokeRect(sh.x + lw, sh.y + lw, sh.w - lw * 2, sh.h - lw * 2);
    }
    ctx.restore();
  }
}

type Drag =
  | { kind: 'move'; index: number; dx: number; dy: number }
  | { kind: 'resize'; index: number; ax: number; ay: number } // ax/ay = fixed opposite corner
  | { kind: 'create'; index: number; ax: number; ay: number };

const MAX_UNDO = 50;

// Interactive editor on a canvas laid over the video. Canvas size = video size.
export class Annotator {
  shapes: Shape[] = [];
  selected = -1;
  tool: Tool = 'select';
  onChange: () => void = () => {};
  onToolChange: (t: Tool) => void = () => {};

  private undoStack: string[] = [];
  private drag: Drag | null = null;
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
  }

  setSize(w: number, h: number): void {
    if (this.canvas.width === w && this.canvas.height === h && this.shapes.length) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.shapes = defaultShapes(w, h);
    this.undoStack = [];
    this.selected = 1;
    this.render();
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.onToolChange(t);
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.shapes = JSON.parse(prev);
    this.selected = Math.min(this.selected, this.shapes.length - 1);
    this.changed();
  }

  reset(): void {
    this.pushUndo();
    this.shapes = defaultShapes(this.canvas.width, this.canvas.height);
    this.selected = 1;
    this.changed();
  }

  deleteSelected(): void {
    if (this.selected < 0) return;
    this.pushUndo();
    this.shapes.splice(this.selected, 1);
    this.selected = -1;
    this.changed();
  }

  render(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawShapes(ctx, this.shapes, canvas.height);
    const sh = this.shapes[this.selected];
    if (!sh) return;
    const hs = this.handleSize();
    ctx.save();
    ctx.setLineDash([hs * 0.6, hs * 0.4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(1, hs / 8);
    ctx.strokeRect(sh.x, sh.y, sh.w, sh.h);
    ctx.setLineDash([]);
    for (const [cx, cy] of corners(sh)) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
    }
    ctx.restore();
  }

  // Handle size in source px that appears ~16 screen px.
  private handleSize(): number {
    const r = this.canvas.getBoundingClientRect();
    const scale = r.width ? this.canvas.width / r.width : 1;
    return 16 * scale;
  }

  private pos(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * this.canvas.width) / r.width, ((e.clientY - r.top) * this.canvas.height) / r.height];
  }

  private pushUndo(): void {
    this.undoStack.push(JSON.stringify(this.shapes));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  private changed(): void {
    this.render();
    this.onChange();
  }

  private down(e: PointerEvent): void {
    const [x, y] = this.pos(e);
    this.canvas.setPointerCapture(e.pointerId);
    const hs = this.handleSize() * 1.2;

    if (this.tool !== 'select') {
      this.pushUndo();
      this.shapes.push({ type: this.tool, x, y, w: 0, h: 0 });
      this.selected = this.shapes.length - 1;
      this.drag = { kind: 'create', index: this.selected, ax: x, ay: y };
      return;
    }

    // Corner handles of the selected shape first, then shapes top-down.
    const sel = this.shapes[this.selected];
    if (sel) {
      const cs = corners(sel);
      for (let i = 0; i < 4; i++) {
        const [cx, cy] = cs[i];
        if (Math.abs(x - cx) <= hs && Math.abs(y - cy) <= hs) {
          const [ax, ay] = cs[(i + 2) % 4];
          this.pushUndo();
          this.drag = { kind: 'resize', index: this.selected, ax, ay };
          return;
        }
      }
    }
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      if (hit(s, x, y, hs)) {
        this.pushUndo();
        this.selected = i;
        this.drag = { kind: 'move', index: i, dx: x - s.x, dy: y - s.y };
        this.render();
        return;
      }
    }
    this.selected = -1;
    this.render();
  }

  private move(e: PointerEvent): void {
    if (!this.drag) return;
    const [x, y] = this.pos(e);
    const s = this.shapes[this.drag.index];
    if (this.drag.kind === 'move') {
      s.x = x - this.drag.dx;
      s.y = y - this.drag.dy;
    } else {
      const { ax, ay } = this.drag;
      s.x = Math.min(ax, x);
      s.y = Math.min(ay, y);
      s.w = Math.abs(x - ax);
      s.h = Math.abs(y - ay);
    }
    this.render();
  }

  private up(e: PointerEvent): void {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    const s = this.shapes[d.index];
    if (d.kind === 'create') {
      // A click without dragging makes a default-sized shape at that point.
      if (s.w < 8 || s.h < 8) {
        const k = this.canvas.height / 1080;
        const [w, h] = s.type === 'ellipse' ? [300 * k, 300 * k] : [560 * k, 46 * k];
        s.x -= w / 2;
        s.y -= h / 2;
        s.w = w;
        s.h = h;
      }
      this.setTool('select');
    }
    this.changed();
  }
}

function corners(s: Shape): [number, number][] {
  return [
    [s.x, s.y],
    [s.x + s.w, s.y],
    [s.x + s.w, s.y + s.h],
    [s.x, s.y + s.h],
  ];
}

function hit(s: Shape, x: number, y: number, tol: number): boolean {
  if (s.type === 'rect') return x >= s.x - tol && x <= s.x + s.w + tol && y >= s.y - tol && y <= s.y + s.h + tol;
  const rx = s.w / 2 + tol;
  const ry = s.h / 2 + tol;
  const dx = x - (s.x + s.w / 2);
  const dy = y - (s.y + s.h / 2);
  return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
}
