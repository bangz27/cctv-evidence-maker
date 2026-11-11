// Noto Sans Thai for the page; Sarabun stays for the text drawn into the JPG and clip.
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/700.css';
import '@fontsource/sarabun/400.css';
import '@fontsource/sarabun/700.css';
import './style.css';

import { Annotator, type Tool } from './annotate';
import { Attachments } from './attachments';
import { recordClip, type ClipFormat } from './clip';
import { ensureFonts, renderEvidence, statusName, toJpeg, type Point } from './evidence';
import { buildZip, download, formatBytes, type OutFile } from './files';
import { initStats, track } from './stats';
import { loadForm, saveForm } from './storage';
import { formatSeconds, normalizeTime } from './time';
import { VideoController } from './video';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- elements ----------
const dropzone = $('dropzone');
const fileInput = $<HTMLInputElement>('fileInput');
const fileInput2 = $<HTMLInputElement>('fileInput2');
const changeClipBtn = $('changeClipBtn');
const videoError = $('videoError');
const fileName = $('fileName');
const stage = $('stage');
const videoEl = $<HTMLVideoElement>('video');
const overlay = $<HTMLCanvasElement>('overlay');
const playerControls = $('playerControls');
const scrubber = $<HTMLInputElement>('scrubber');
const timeInfo = $('timeInfo');
const fpsInput = $<HTMLInputElement>('fpsInput');
const playBtn = $<HTMLButtonElement>('playBtn');
const useFrameBtn = $<HTMLButtonElement>('useFrameBtn');
const chosenInfo = $('chosenInfo');
const annotCard = $('annotCard');
const toolSeg = $('toolSeg');
const parcelInput = $<HTMLInputElement>('parcelInput');
const statusInput = $<HTMLSelectElement>('statusInput');
const fmsTimeInput = $<HTMLInputElement>('fmsTimeInput');
const cctvTimeInput = $<HTMLInputElement>('cctvTimeInput');
const timeMatch = $('timeMatch');
const destInput = $<HTMLInputElement>('destInput');
const ltInput = $<HTMLInputElement>('ltInput');
const fmsFileInput = $<HTMLInputElement>('fmsFileInput');
const fmsStatus = $('fmsStatus');
const fmsEditor = $('fmsEditor');
const fmsCanvas = $<HTMLCanvasElement>('fmsCanvas');
const fmsPointInfo = $('fmsPointInfo');
const clipStart = $<HTMLInputElement>('clipStart');
const clipEnd = $<HTMLInputElement>('clipEnd');
const recordBtn = $<HTMLButtonElement>('recordBtn');
const recordProgress = $<HTMLProgressElement>('recordProgress');
const recOverlay = $('recOverlay');
const recOverlayProgress = $<HTMLProgressElement>('recOverlayProgress');
const recOverlayTime = $('recOverlayTime');
const recOverlayTitle = $('recOverlayTitle');
const recOverlayWarn = $('recOverlayWarn');
const recOverlaySub = $('recOverlaySub');
const resultCard = $('resultCard');
const resultMsg = $('resultMsg');
const evidencePreview = $<HTMLImageElement>('evidencePreview');
const fileList = $('fileList');

// ---------- state ----------
// One case = one parcel: its FMS screenshot, the arrow point on it and the last JPG built.
interface FmsData {
  fms?: ImageBitmap;
  point?: Point; // FMS image pixels
  evidence?: Blob;
}

const vc = new VideoController(videoEl);
const annot = new Annotator(overlay);
const fmsData: FmsData = {};
const attachments = new Attachments($('attachGrid'));
let chosen: { canvas: HTMLCanvasElement; time: number } | null = null;
// parcel = the number written on the clip's text bar when it was recorded.
let clip: { blob: Blob; format: ClipFormat; parcel: string; stale: boolean } | null = null;
let previewUrl = '';
let busy = false;

// ---------- messages ----------
function showMsg(text: string, kind: 'ok' | 'warn' | 'error' = 'ok'): void {
  resultCard.hidden = false;
  resultMsg.hidden = false;
  resultMsg.className = `alert ${kind}`;
  resultMsg.textContent = text;
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- case form ----------
function caseData() {
  return {
    parcel: parcelInput.value.trim().toUpperCase(),
    status: statusInput.value.trim(),
    fmsTime: normalizeTime(fmsTimeInput.value),
    cctvTime: normalizeTime(cctvTimeInput.value),
    dest: destInput.value.trim(), // kept as typed: may be a hub name, not only a code like SOCN
    lt: ltInput.value.trim().toUpperCase(),
  };
}

function onFormChange(): void {
  saveForm({
    parcel: parcelInput.value,
    status: statusInput.value,
    fmsTime: fmsTimeInput.value,
    cctvTime: cctvTimeInput.value,
    dest: destInput.value,
    lt: ltInput.value,
  });
  const { fmsTime, cctvTime, status } = caseData();
  // "เวลา FMHub_LHPacking" and similar texts follow the chosen status.
  document.querySelectorAll('.status-name').forEach((el) => (el.textContent = statusName(status)));
  if (fmsData.fms) renderFms();
  if (!fmsTime || !cctvTime) {
    timeMatch.className = 'time-match';
    timeMatch.textContent = 'กรอกเวลาเป็น HH:MM:SS เช่น 20:52:25';
  } else if (fmsTime === cctvTime) {
    timeMatch.className = 'time-match ok';
    timeMatch.textContent = '✔ เวลาตรงกัน → ป้ายจะเขียน "(ตรงกับ CCTV)"';
  } else {
    timeMatch.className = 'time-match warn';
    timeMatch.textContent = 'เวลาไม่ตรงกัน → ป้ายจะเขียน "(ใกล้เคียง CCTV)"';
  }
}

// Anything that changes what the JPG would show makes the last one outdated.
function invalidateEvidence(): void {
  fmsData.evidence = undefined;
  renderFmsStatus();
  renderFiles();
}

function renderFmsStatus(): void {
  const chip = (ok: boolean, okText: string, noText: string) =>
    `<span class="chip ${ok ? 'ok' : ''}">${ok ? okText : noText}</span>`;
  fmsStatus.innerHTML =
    chip(!!fmsData.fms, '✔ FMS', '✖ FMS') +
    chip(!!fmsData.point, '✔ จุดลูกศร', '– จุดลูกศร') +
    chip(!!fmsData.evidence, '✔ JPG', '– JPG');
}

async function setFms(blob: Blob): Promise<void> {
  try {
    fmsData.fms = await createImageBitmap(blob);
  } catch {
    showMsg('อ่านไฟล์ภาพ FMS ไม่ได้', 'error');
    return;
  }
  fmsData.point = undefined;
  invalidateEvidence();
  renderFms();
}

fmsFileInput.addEventListener('change', () => {
  const f = fmsFileInput.files?.[0];
  if (f) void setFms(f);
  fmsFileInput.value = '';
});

function renderFms(): void {
  const p = fmsData;
  if (!p.fms) {
    fmsEditor.hidden = true;
    return;
  }
  fmsEditor.hidden = false;
  fmsCanvas.width = p.fms.width;
  fmsCanvas.height = p.fms.height;
  const ctx = fmsCanvas.getContext('2d')!;
  ctx.drawImage(p.fms, 0, 0);
  if (p.point) {
    const r = Math.max(10, p.fms.width / 120);
    ctx.strokeStyle = '#E61E1E';
    ctx.fillStyle = 'rgba(230,30,30,0.25)';
    ctx.lineWidth = Math.max(3, r / 3);
    ctx.beginPath();
    ctx.arc(p.point.x, p.point.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  fmsPointInfo.textContent = p.point
    ? '✔ ตั้งจุดลูกศรแล้ว (คลิกใหม่เพื่อย้าย)'
    : `คลิกบนภาพตรงบรรทัด ${statusName(caseData().status)} เพื่อกำหนดจุดที่ลูกศรชี้`;
}

fmsCanvas.addEventListener('click', (e) => {
  if (!fmsData.fms) return;
  const r = fmsCanvas.getBoundingClientRect();
  fmsData.point = {
    x: ((e.clientX - r.left) * fmsCanvas.width) / r.width,
    y: ((e.clientY - r.top) * fmsCanvas.height) / r.height,
  };
  invalidateEvidence();
  renderFms();
});

document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  const blob = item?.getAsFile();
  if (!blob) return;
  e.preventDefault();
  void setFms(blob);
});

// ---------- video ----------
async function loadFile(file: File): Promise<void> {
  videoError.hidden = true;
  fileName.textContent = `${file.name} · ${formatBytes(file.size)}`;
  stage.hidden = false;
  try {
    await vc.load(file);
  } catch (err) {
    stage.hidden = true;
    playerControls.hidden = true;
    annotCard.hidden = true;
    dropzone.hidden = false;
    videoError.hidden = false;
    videoError.textContent = (err as Error).message;
    return;
  }
  stage.style.aspectRatio = `${vc.width} / ${vc.height}`;
  annot.setSize(vc.width, vc.height);
  dropzone.hidden = true;
  changeClipBtn.hidden = false;
  playerControls.hidden = false;
  annotCard.hidden = false;
  fileName.textContent += ` · ${vc.width}×${vc.height} · ${formatSeconds(vc.duration)} วิ`;
  fpsInput.value = String(vc.fps);
  scrubber.max = String(vc.duration);
  chosen = null;
  clip = null;
  clipStart.value = '';
  clipEnd.value = '';
  renderChosen();
  invalidateEvidence();
  updateTime();
}

function updateTime(): void {
  const t = videoEl.currentTime;
  if (document.activeElement !== scrubber) scrubber.value = String(t);
  timeInfo.textContent = `${formatSeconds(t)} / ${formatSeconds(vc.duration)} วิ · เฟรม ${vc.frameIndex}`;
  playBtn.textContent = videoEl.paused ? '▶ เล่น' : '⏸ หยุด';
}

function playLoop(): void {
  updateTime();
  if (!videoEl.paused) requestAnimationFrame(playLoop);
}

function renderChosen(): void {
  if (!chosen) {
    chosenInfo.textContent = 'ยังไม่ได้เลือกเฟรม — หาเฟรมที่เห็นจังหวะยิงขึ้นรถ แล้วกด "ใช้เฟรมนี้"';
    chosenInfo.className = 'chosen';
    return;
  }
  chosenInfo.className = 'chosen ok';
  chosenInfo.innerHTML = '';
  chosenInfo.append(`✔ เฟรมที่เลือก: ${formatSeconds(chosen.time)} วิ `);
  const back = document.createElement('button');
  back.className = 'btn small';
  back.textContent = 'กลับไปเฟรมนี้';
  back.onclick = () => chosen && void vc.seek(chosen.time).then(updateTime);
  chosenInfo.append(back);
}

function bindFileInput(input: HTMLInputElement): void {
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void loadFile(f);
    input.value = '';
  });
}
bindFileInput(fileInput);
bindFileInput(fileInput2);

for (const ev of ['dragenter', 'dragover'] as const) {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('over');
  });
}
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) void loadFile(f);
});
// Dropping anywhere else must not navigate away from the app.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (f?.type.startsWith('video/')) void loadFile(f);
});

videoEl.addEventListener('seeked', updateTime);
videoEl.addEventListener('pause', updateTime);
videoEl.addEventListener('play', () => requestAnimationFrame(playLoop));
scrubber.addEventListener('input', () => {
  videoEl.pause();
  videoEl.currentTime = Number(scrubber.value);
  updateTime();
});
fpsInput.addEventListener('change', () => {
  const v = Number(fpsInput.value);
  if (v >= 1 && v <= 120) vc.fps = v;
  fpsInput.value = String(vc.fps);
  updateTime();
});

function step(kind: string): void {
  const p = kind.endsWith('f') ? vc.stepFrames(kind.startsWith('-') ? -1 : 1) : vc.stepSeconds(kind.startsWith('-') ? -1 : 1);
  void p.then(updateTime);
}
document.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => b.addEventListener('click', () => step(b.dataset.step!)));
playBtn.addEventListener('click', () => (videoEl.paused ? void videoEl.play() : videoEl.pause()));

useFrameBtn.addEventListener('click', async () => {
  videoEl.pause();
  // A seek in flight still shows the previous frame; capture only once it has landed.
  if (videoEl.seeking) await new Promise((r) => videoEl.addEventListener('seeked', r, { once: true }));
  chosen = { canvas: vc.captureFrame(), time: videoEl.currentTime };
  if (!clipStart.value) clipStart.value = Math.max(0, chosen.time - 10).toFixed(1);
  if (!clipEnd.value) clipEnd.value = Math.min(vc.duration, chosen.time + 10).toFixed(1);
  renderChosen();
  invalidateEvidence();
});

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (playerControls.hidden || t.closest('input, textarea, select')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    step(`${e.key === 'ArrowLeft' ? '-' : '+'}1${e.shiftKey ? 's' : 'f'}`);
  } else if (e.key === ' ') {
    e.preventDefault();
    playBtn.click();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    annot.deleteSelected();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    annot.undo();
  }
});

// ---------- read the on-screen clock (OCR) ----------
const ocrStatus = $('ocrStatus');
const clockBox = () => annot.shapes.find((s) => s.type === 'rect');

function ocrMsg(text: string, kind: '' | 'ok' | 'warn' = ''): void {
  ocrStatus.textContent = text;
  ocrStatus.className = `hint ${kind ? `ocr-${kind}` : ''}`;
}

// Reads the clock in the yellow box at video time t (or the frame shown now).
async function clockAt(t?: number): Promise<string | null> {
  const { readClock } = await import('./ocr');
  if (t !== undefined) await vc.seek(t);
  else if (videoEl.seeking) await new Promise((r) => videoEl.addEventListener('seeked', r, { once: true }));
  return (await readClock(videoEl, clockBox()!)).time;
}

function ocrReady(): boolean {
  if (!vc.width) return ocrMsg('ยังไม่ได้เปิดคลิป', 'warn'), false;
  if (!clockBox()) return ocrMsg('ไม่มีกรอบเหลือง — กด "+ กรอบเหลือง" แล้ววางครอบเวลามุมจอ', 'warn'), false;
  return true;
}

$('readClockBtn').addEventListener('click', () =>
  guarded(async () => {
    if (!ocrReady()) return;
    videoEl.pause();
    ocrMsg('กำลังอ่านเวลาจากจอ… (ครั้งแรกโหลดระบบอ่านตัวอักษรสักครู่)');
    const time = await clockAt();
    if (!time) return ocrMsg('อ่านเวลาไม่ได้ — ตรวจว่ากรอบเหลืองครอบเวลามุมจอพอดี แล้วลองใหม่ หรือกรอกเอง', 'warn');
    cctvTimeInput.value = time;
    track('ocr-read');
    onFormChange();
    invalidateEvidence();
    ocrMsg(`อ่านได้ ${time} → ใส่ในช่องเวลา CCTV แล้ว · ตรวจกับภาพอีกครั้ง`, 'ok');
  }),
);

// Finds the frame whose clock shows the FMS time. DVR exports don't keep one speed: a clip can
// run in real time and then switch to fast-forward. So this keeps a bracket [lo, hi] of frames
// whose clocks are before/after the target and narrows it, interpolating inside the bracket.
$('seekFmsBtn').addEventListener('click', () =>
  guarded(async () => {
    if (!ocrReady()) return;
    const target = caseData().fmsTime;
    if (!target) return ocrMsg(`กรอกเวลา ${statusName(caseData().status)} ในข้อมูลเคสก่อน`, 'warn');
    videoEl.pause();
    const { toSeconds } = await import('./ocr');
    const T = toSeconds(target);
    const tEnd = Math.max(0, vc.duration - 0.05);
    ocrMsg(`กำลังหาเวลา ${target}… (ครั้งแรกโหลดระบบอ่านตัวอักษรสักครู่)`);
    // Clock at the first readable frame near t, stepping in the given direction.
    const readNear = async (t: number, dir: 1 | -1): Promise<[number, number] | null> => {
      for (let i = 0; i < 4; i++) {
        const tt = Math.min(Math.max(0, t + dir * i * 0.5), tEnd);
        const time = await clockAt(tt);
        if (time) return [tt, toSeconds(time)];
      }
      return null;
    };
    let lo = await readNear(0, 1);
    let hi = await readNear(tEnd, -1);
    if (!lo || !hi) return ocrMsg('อ่านเวลาจากจอไม่ได้ — ตรวจว่ากรอบเหลืองครอบเวลามุมจอพอดี', 'warn');
    if (hi[1] < lo[1]) return ocrMsg('เวลาบนจอไม่ได้เดินไปข้างหน้า (อ่านผิดหรือข้ามเที่ยงคืน) — หาเฟรมเอง', 'warn');
    const fmt = (s: number) => new Date(s * 1000).toISOString().slice(11, 19);
    if (T < lo[1] || T > hi[1]) return ocrMsg(`เวลา ${target} ไม่อยู่ในคลิปนี้ (คลิปนี้ ${fmt(lo[1])}–${fmt(hi[1])})`, 'warn');
    let found: string | null = T === lo[1] ? target : T === hi[1] ? target : null;
    if (found) await vc.seek(T === lo[1] ? lo[0] : hi[0]);
    const frame = 1 / vc.fps;
    for (let i = 0; i < 16 && !found && hi[0] - lo[0] > frame; i++) {
      const span = hi[0] - lo[0];
      // Interpolate toward the middle of the target second, but never hug either end of the
      // bracket, so a clock that changes speed can't stall the search.
      let t: number = lo[0] + ((T + 0.5 - lo[1]) * span) / Math.max(1, hi[1] - lo[1]);
      t = Math.min(Math.max(t, lo[0] + span * 0.1), hi[0] - span * 0.1);
      let time = await clockAt(t);
      if (!time) time = await clockAt((t = lo[0] + span / 2));
      if (!time) break;
      const c = toSeconds(time);
      if (c === T) found = time;
      else if (c < T) lo = [t, c];
      else hi = [t, c];
    }
    if (!found) {
      // In fast-forward parts one frame can skip several clock seconds, so the exact second may
      // not exist on any frame: go to the closer side of the bracket and say what it shows.
      const best = T - lo[1] <= hi[1] - T ? lo : hi;
      await vc.seek(best[0]);
      updateTime();
      cctvTimeInput.value = fmt(best[1]);
      track('ocr-seek-nearest');
      onFormChange();
      invalidateEvidence();
      return ocrMsg(
        `ไม่มีเฟรมที่จอแสดง ${target} พอดี (ช่วงนี้ของคลิปน่าจะเป็นแบบเร่งความเร็ว) · ไปที่เฟรมใกล้ที่สุด จอแสดง ${fmt(best[1])} และใส่ช่องเวลา CCTV แล้ว (ป้ายจะเขียน "ใกล้เคียง CCTV") · ตรวจกับภาพ`,
        'warn',
      );
    }
    updateTime();
    cctvTimeInput.value = found;
    track('ocr-seek-found');
    onFormChange();
    invalidateEvidence();
    ocrMsg(`เจอเฟรมที่จอแสดง ${found} (ที่ ${formatSeconds(videoEl.currentTime)} วิในคลิป) · ใส่ช่องเวลา CCTV แล้ว · ตรวจกับภาพ ปรับด้วย ◀ ▶ แล้วกด ✔ ใช้เฟรมนี้`, 'ok');
  }),
);

// ---------- annotation ----------
annot.onToolChange = (tool: Tool) => {
  toolSeg.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  overlay.style.cursor = tool === 'select' ? 'default' : 'crosshair';
};
annot.onChange = () => {
  if (clip) clip.stale = true;
  invalidateEvidence();
};
toolSeg.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.addEventListener('click', () => annot.setTool(b.dataset.tool as Tool)));
$('deleteShapeBtn').addEventListener('click', () => annot.deleteSelected());
$('undoBtn').addEventListener('click', () => annot.undo());
$('resetBtn').addEventListener('click', () => annot.reset());

// ---------- evidence ----------
// Nothing is required. Missing pieces are listed as notes; they never block an export.
function missingNotes(): string[] {
  const c = caseData();
  const notes: string[] = [];
  if (!chosen) notes.push('ไม่มีภาพ CCTV (ยังไม่ได้กด "ใช้เฟรมนี้")');
  if (!fmsData.fms) notes.push('ไม่มีภาพ FMS');
  else if (!fmsData.point) notes.push('ไม่มีลูกศร (ยังไม่ได้คลิกจุดบนภาพ FMS)');
  if (!c.parcel) notes.push('ไม่ได้กรอกเลขพัสดุ');
  if (fmsTimeInput.value.trim() && !c.fmsTime) notes.push(`เวลา ${statusName(c.status)} รูปแบบไม่ถูกต้อง จึงไม่ได้ใส่ในภาพ`);
  if (cctvTimeInput.value.trim() && !c.cctvTime) notes.push('เวลา CCTV รูปแบบไม่ถูกต้อง จึงไม่ได้ใส่ในภาพ');
  return notes;
}

// The JPG needs at least one of its two pictures.
const canMakeEvidence = () => !!chosen || !!fmsData.fms;

// File names follow the parcel number when there is one; LT photos follow the LT number.
function names() {
  const { parcel, lt } = caseData();
  const folder = parcel || lt || 'Evidence';
  return {
    folder,
    lt,
    jpg: parcel ? `${parcel}_Evidence.jpg` : 'Evidence.jpg',
    clip: (ext: string, p = parcel) => (p ? `CCTV_${p}.${ext}` : `CCTV.${ext}`),
    zip: folder === 'Evidence' ? 'Evidence.zip' : `${folder}_Evidence.zip`,
  };
}

function withNotes(head: string, notes: string[]): [string, 'ok' | 'warn'] {
  return notes.length ? [`${head}\n${notes.join('\n')}`, 'warn'] : [head, 'ok'];
}

async function makeEvidence(): Promise<Blob> {
  const c = caseData();
  await ensureFonts();
  const canvas = renderEvidence({
    parcel: c.parcel,
    status: c.status,
    lt: c.lt,
    cctvTime: c.cctvTime,
    fmsTime: c.fmsTime,
    frame: chosen?.canvas,
    shapes: annot.shapes,
    fms: fmsData.fms,
    point: fmsData.point,
  });
  fmsData.evidence = await toJpeg(canvas);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(fmsData.evidence);
  evidencePreview.src = previewUrl;
  evidencePreview.hidden = false;
  return fmsData.evidence;
}

async function guarded(fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  document.body.classList.add('busy');
  try {
    await fn();
  } catch (err) {
    showMsg(`เกิดข้อผิดพลาด: ${(err as Error).message}`, 'error');
  } finally {
    busy = false;
    document.body.classList.remove('busy');
  }
}

$('makeOneBtn').addEventListener('click', () =>
  guarded(async () => {
    if (!canMakeEvidence()) return showMsg('ยังไม่มีภาพ CCTV หรือภาพ FMS ให้ทำภาพหลักฐาน', 'warn');
    const { jpg } = names();
    const blob = await makeEvidence();
    download(blob, jpg);
    track('jpg');
    renderFmsStatus();
    renderFiles();
    showMsg(...withNotes(`สร้าง ${jpg} แล้ว (${formatBytes(blob.size)})`, missingNotes()));
  }),
);

// ---------- clip ----------
$('clipStartNow').addEventListener('click', () => (clipStart.value = videoEl.currentTime.toFixed(1)));
$('clipEndNow').addEventListener('click', () => (clipEnd.value = videoEl.currentTime.toFixed(1)));

recordBtn.addEventListener('click', () =>
  guarded(async () => {
    const c = caseData();
    // A clip still needs a video and a range to record; the text fields are optional.
    const errs: string[] = [];
    if (!vc.width) errs.push('ยังไม่ได้เปิดคลิป');
    const start = Number(clipStart.value);
    const end = Math.min(Number(clipEnd.value), vc.duration);
    if (vc.width && !(clipStart.value && clipEnd.value && end > start)) errs.push('ช่วงคลิปไม่ถูกต้อง (จบต้องมากกว่าเริ่ม)');
    if (errs.length) return showMsg(errs.join('\n'), 'error');

    const barText = [
      c.parcel,
      c.fmsTime && `${c.status || 'LHPacking'} ${c.fmsTime}`,
      c.dest ? `ยิงขึ้นรถ Shuttle ไป ${c.dest}` : 'ยิงขึ้นรถ Shuttle',
    ]
      .filter(Boolean)
      .join(' | ');
    const back = videoEl.currentTime;
    recordBtn.textContent = '● กำลังสร้างคลิป...';
    recordProgress.hidden = false;
    recordProgress.value = 0;
    const title = document.title;
    const total = end - start;
    const showProgress = (f: number) => {
      recordProgress.value = f;
      recOverlayProgress.value = f;
      recOverlayTime.textContent = `${(f * total).toFixed(1)} / ${total.toFixed(1)} วิ`;
    };
    showProgress(0);
    recOverlay.hidden = false;
    // Only the real-time fallback suffers in a background tab: warn for that one only.
    let realtime = false;
    let wentHidden = false;
    const onHide = () => (wentHidden ||= realtime && document.hidden);
    document.addEventListener('visibilitychange', onHide);
    const setRealtime = (on: boolean) => {
      realtime = on;
      recOverlayWarn.hidden = recOverlaySub.hidden = !on;
      recOverlayTitle.lastChild!.textContent = on ? 'กำลังอัดคลิป…' : 'กำลังสร้างคลิป…';
      document.title = on ? '● กำลังอัด — อย่าสลับแท็บ' : '● กำลังสร้างคลิป…';
      if (on) wentHidden = document.hidden;
    };
    const t0 = performance.now();
    try {
      setRealtime(false);
      // Loaded on first use: the MP4 demuxer/muxer would more than double the page's JS.
      const { FastClipUnavailable, renderClipFast } = await import('./fastclip');
      try {
        if (!vc.file) throw new FastClipUnavailable('no file');
        const blob = await renderClipFast({ file: vc.file, start, end, srcW: vc.width, srcH: vc.height, shapes: annot.shapes, barText, onProgress: showProgress });
        clip = { blob, format: { mime: 'video/mp4', ext: 'mp4' }, parcel: c.parcel, stale: false };
        track('clip-fast');
      } catch (err) {
        if (!(err instanceof FastClipUnavailable)) throw err;
        console.info('fast clip unavailable, recording in real time:', err.message);
        setRealtime(true);
        showProgress(0);
        const res = await recordClip({ video: vc, start, end, shapes: annot.shapes, barText, onProgress: showProgress });
        clip = { ...res, parcel: c.parcel, stale: false };
        track('clip-realtime');
      }
    } finally {
      recOverlay.hidden = true;
      document.title = title;
      document.removeEventListener('visibilitychange', onHide);
      recordBtn.textContent = '● สร้างคลิป 1280×720';
      recordProgress.hidden = true;
      await vc.seek(back);
      updateTime();
    }
    renderFiles();
    const notes = [
      clip.blob.size > 10 * 1024 * 1024 ? 'เกิน 10MB ลองตัดช่วงให้สั้นลง' : '',
      wentHidden ? 'มีการสลับไปแท็บอื่นระหว่างอัด คลิปอาจกระตุกหรือขาด — แนะนำให้อัดใหม่โดยเปิดหน้านี้ค้างไว้' : '',
    ].filter(Boolean);
    const took = ((performance.now() - t0) / 1000).toFixed(1);
    const how = realtime ? 'อัดแบบเวลาจริง' : `ใช้เวลาสร้าง ${took} วิ`;
    showMsg(...withNotes(`สร้างคลิปเสร็จ ${clip.format.ext.toUpperCase()} ${formatBytes(clip.blob.size)} (คลิปยาว ${total.toFixed(1)} วิ · ${how})`, notes));
  }),
);

// ---------- files & ZIP ----------
function renderFiles(): void {
  fileList.innerHTML = '';
  const add = (name: string, blob: Blob, note = '') => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = `${name} · ${formatBytes(blob.size)}${note}`;
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = '⬇';
    btn.title = 'ดาวน์โหลด';
    btn.onclick = () => download(blob, name);
    li.append(span, btn);
    fileList.append(li);
  };
  const n = names();
  if (fmsData.evidence) add(n.jpg, fmsData.evidence);
  if (clip) {
    const note = clip.stale ? ' · ⚠ แก้วงหลังอัด อัดใหม่ถ้าต้องการ' : '';
    add(n.clip(clip.format.ext, clip.parcel), clip.blob, note);
  }
  if (fileList.childElementCount) resultCard.hidden = false;
}

$('zipBtn').addEventListener('click', () =>
  guarded(async () => {
    const { parcel } = caseData();
    const n = names();
    // Always rebuild the JPG so the ZIP matches the current frame, shapes and form.
    const files: OutFile[] = [];
    if (canMakeEvidence()) files.push({ path: `${n.folder}/${n.jpg}`, blob: await makeEvidence() });
    if (clip) files.push({ path: `${n.folder}/${n.clip(clip.format.ext)}`, blob: clip.blob });
    files.push(...attachments.zipEntries(n.folder, n.lt));
    if (!files.length) return showMsg('ยังไม่มีไฟล์ให้รวม — ต้องมีภาพ CCTV, ภาพ FMS, คลิป หรือรูปหลักฐาน LT อย่างน้อย 1 อย่าง', 'warn');
    const zip = await buildZip(files);
    download(zip, n.zip);
    track('zip');
    renderFmsStatus();
    renderFiles();
    const extra = attachments.count ? ` · รูปหลักฐาน LT ${attachments.count} รูป` : '';
    const notes = [
      ...(canMakeEvidence() ? missingNotes() : ['ไม่มีภาพหลักฐาน JPG (ไม่มีทั้งภาพ CCTV และภาพ FMS)']),
      clip ? '' : 'ยังไม่ได้อัดคลิป',
      clip && clip.parcel !== parcel ? `คลิปอัดไว้ตอนเลขพัสดุเป็น "${clip.parcel || 'ว่าง'}" — อัดใหม่ให้แถบข้อความตรง` : '',
      attachments.count && !n.lt ? 'ไม่ได้กรอกเลข LT — รูปหลักฐาน LT ตั้งชื่อเป็น Runsheet / TruckRear / Seal' : '',
    ].filter(Boolean);
    showMsg(...withNotes(`${n.zip} ${formatBytes(zip.size)} · ${files.length} ไฟล์${extra}`, notes));
  }),
);

// ---------- init ----------
const saved = loadForm();
parcelInput.value = saved.parcel ?? '';
statusInput.value = saved.status ?? '';
fmsTimeInput.value = saved.fmsTime ?? '';
cctvTimeInput.value = saved.cctvTime ?? '';
destInput.value = saved.dest ?? '';
ltInput.value = saved.lt ?? '';
for (const el of [parcelInput, statusInput, fmsTimeInput, cctvTimeInput, destInput, ltInput]) el.addEventListener('input', onFormChange);
// The parcel number, LT number and Lost status are in the JPG header (the parcel also in file names).
for (const el of [parcelInput, statusInput, ltInput]) el.addEventListener('input', invalidateEvidence);

// Clears everything that belongs to one case. The opened CCTV clip and the shapes stay,
// since the next parcel is often on the same clip.
$('newCaseBtn').addEventListener('click', () => {
  if (busy) return;
  if (!confirm('เริ่มเคสใหม่?\nจะล้างข้อมูลเคส ภาพ FMS รูปหลักฐาน LT เฟรมที่เลือก และคลิปที่อัดไว้\n(คลิป CCTV ที่เปิดอยู่และวงยังอยู่)')) return;
  for (const el of [parcelInput, fmsTimeInput, cctvTimeInput, destInput, ltInput]) el.value = '';
  statusInput.value = '';
  fmsData.fms = fmsData.point = fmsData.evidence = undefined;
  attachments.clear();
  chosen = null;
  clip = null;
  clipStart.value = clipEnd.value = '';
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  evidencePreview.hidden = true;
  resultMsg.hidden = true;
  resultCard.hidden = true;
  onFormChange();
  renderFms();
  renderChosen();
  invalidateEvidence();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
onFormChange();
renderChosen();
renderFmsStatus();
initStats();

if (import.meta.env.DEV) {
  Object.assign(window, { __cctv: { loadFile, setFms, fmsData, annot, vc, attachments } });
}
