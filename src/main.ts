import '@fontsource/sarabun/400.css';
import '@fontsource/sarabun/700.css';
import './style.css';

import { Annotator, type Tool } from './annotate';
import { recordClip, type ClipFormat } from './clip';
import { ensureFonts, renderEvidence, toJpeg, type Point } from './evidence';
import { buildZip, download, formatBytes, type OutFile } from './files';
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
const fmsTimeInput = $<HTMLInputElement>('fmsTimeInput');
const cctvTimeInput = $<HTMLInputElement>('cctvTimeInput');
const timeMatch = $('timeMatch');
const destInput = $<HTMLInputElement>('destInput');
const fmsFileInput = $<HTMLInputElement>('fmsFileInput');
const fmsStatus = $('fmsStatus');
const fmsEditor = $('fmsEditor');
const fmsCanvas = $<HTMLCanvasElement>('fmsCanvas');
const fmsPointInfo = $('fmsPointInfo');
const clipStart = $<HTMLInputElement>('clipStart');
const clipEnd = $<HTMLInputElement>('clipEnd');
const recordBtn = $<HTMLButtonElement>('recordBtn');
const recordProgress = $<HTMLProgressElement>('recordProgress');
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
    fmsTime: normalizeTime(fmsTimeInput.value),
    cctvTime: normalizeTime(cctvTimeInput.value),
    dest: destInput.value.trim().toUpperCase(),
  };
}

function onFormChange(): void {
  saveForm({
    parcel: parcelInput.value,
    fmsTime: fmsTimeInput.value,
    cctvTime: cctvTimeInput.value,
    dest: destInput.value,
  });
  const { fmsTime, cctvTime } = caseData();
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
    : 'คลิกบนภาพตรงบรรทัด FMHub_LHPacking เพื่อกำหนดจุดที่ลูกศรชี้';
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
function baseErrors(): string[] {
  const c = caseData();
  const errs: string[] = [];
  if (!chosen) errs.push('ยังไม่ได้เลือกเฟรม CCTV (กด "ใช้เฟรมนี้")');
  if (!c.parcel) errs.push('ยังไม่ได้กรอกเลขพัสดุ');
  if (!c.fmsTime) errs.push('เวลา FMHub_LHPacking ไม่ถูกต้อง (HH:MM:SS)');
  if (!c.cctvTime) errs.push('ยังไม่ได้กรอกเวลา CCTV ที่อ่านจากมุมจอ (HH:MM:SS)');
  if (!fmsData.fms) errs.push('ยังไม่มีภาพ FMS (กด Ctrl+V หรือเลือกไฟล์)');
  return errs;
}

async function makeEvidence(): Promise<Blob> {
  const c = caseData();
  await ensureFonts();
  const canvas = renderEvidence({
    parcel: c.parcel,
    cctvTime: c.cctvTime!,
    fmsTime: c.fmsTime!,
    frame: chosen!.canvas,
    shapes: annot.shapes,
    fms: fmsData.fms!,
    point: fmsData.point,
  });
  fmsData.evidence = await toJpeg(canvas);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(fmsData.evidence);
  evidencePreview.src = previewUrl;
  evidencePreview.hidden = false;
  return fmsData.evidence;
}

function noPointNote(): string {
  return fmsData.point ? '' : 'ไม่มีลูกศร (ยังไม่ได้คลิกจุดบนภาพ FMS)';
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
    const errs = baseErrors();
    if (errs.length) return showMsg(errs.join('\n'), 'error');
    const { parcel } = caseData();
    const blob = await makeEvidence();
    download(blob, `${parcel}_Evidence.jpg`);
    renderFmsStatus();
    renderFiles();
    const note = noPointNote();
    showMsg(`สร้าง ${parcel}_Evidence.jpg แล้ว (${formatBytes(blob.size)})${note ? ' · ' + note : ''}`, note ? 'warn' : 'ok');
  }),
);

// ---------- clip ----------
$('clipStartNow').addEventListener('click', () => (clipStart.value = videoEl.currentTime.toFixed(1)));
$('clipEndNow').addEventListener('click', () => (clipEnd.value = videoEl.currentTime.toFixed(1)));

recordBtn.addEventListener('click', () =>
  guarded(async () => {
    const c = caseData();
    const errs: string[] = [];
    if (!vc.width) errs.push('ยังไม่ได้เปิดคลิป');
    if (!c.parcel) errs.push('ยังไม่ได้กรอกเลขพัสดุ');
    if (!c.fmsTime) errs.push('เวลา FMHub_LHPacking ไม่ถูกต้อง (HH:MM:SS)');
    if (!c.dest) errs.push('ยังไม่ได้กรอกปลายทาง');
    const start = Number(clipStart.value);
    const end = Math.min(Number(clipEnd.value), vc.duration);
    if (!(clipStart.value && clipEnd.value && end > start)) errs.push('ช่วงคลิปไม่ถูกต้อง (จบต้องมากกว่าเริ่ม)');
    if (errs.length) return showMsg(errs.join('\n'), 'error');

    const back = videoEl.currentTime;
    recordBtn.textContent = '● กำลังอัด...';
    recordProgress.hidden = false;
    recordProgress.value = 0;
    try {
      const res = await recordClip({
        video: vc,
        start,
        end,
        shapes: annot.shapes,
        barText: `${c.parcel} | LHPacking ${c.fmsTime} | ยิงขึ้นรถ Shuttle ไป ${c.dest}`,
        onProgress: (f) => (recordProgress.value = f),
      });
      clip = { ...res, parcel: c.parcel, stale: false };
    } finally {
      recordBtn.textContent = '● อัดคลิป 1280×720';
      recordProgress.hidden = true;
      await vc.seek(back);
      updateTime();
    }
    renderFiles();
    const big = clip.blob.size > 10 * 1024 * 1024 ? ' · เกิน 10MB ลองตัดช่วงให้สั้นลง' : '';
    showMsg(`อัดคลิปเสร็จ ${clip.format.ext.toUpperCase()} ${formatBytes(clip.blob.size)} (${(end - start).toFixed(1)} วิ)${big}`, big ? 'warn' : 'ok');
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
  const { parcel } = caseData();
  if (fmsData.evidence) add(`${parcel}_Evidence.jpg`, fmsData.evidence);
  if (clip) {
    const note = clip.stale ? ' · ⚠ แก้วงหลังอัด อัดใหม่ถ้าต้องการ' : '';
    add(`CCTV_${clip.parcel}.${clip.format.ext}`, clip.blob, note);
  }
  if (fileList.childElementCount) resultCard.hidden = false;
}

$('zipBtn').addEventListener('click', () =>
  guarded(async () => {
    const errs = baseErrors();
    if (errs.length) return showMsg(errs.join('\n'), 'error');
    const { parcel } = caseData();
    // Always rebuild so the ZIP matches the current frame, shapes and form.
    const files: OutFile[] = [{ path: `${parcel}/${parcel}_Evidence.jpg`, blob: await makeEvidence() }];
    if (clip) files.push({ path: `${parcel}/CCTV_${parcel}.${clip.format.ext}`, blob: clip.blob });
    const zip = await buildZip(files);
    download(zip, `${parcel}_Evidence.zip`);
    renderFmsStatus();
    renderFiles();
    const notes = [
      clip ? '' : 'ยังไม่ได้อัดคลิป — ZIP มีแต่ภาพ',
      clip && clip.parcel !== parcel ? `คลิปอัดไว้ตอนเลขพัสดุเป็น ${clip.parcel} — อัดใหม่ให้แถบข้อความตรง` : '',
      noPointNote(),
    ].filter(Boolean);
    showMsg(`ZIP ${formatBytes(zip.size)} · ${parcel}${notes.length ? '\n' + notes.join('\n') : ''}`, notes.length ? 'warn' : 'ok');
  }),
);

// ---------- init ----------
const saved = loadForm();
parcelInput.value = saved.parcel ?? '';
fmsTimeInput.value = saved.fmsTime ?? '';
cctvTimeInput.value = saved.cctvTime ?? '';
destInput.value = saved.dest ?? '';
for (const el of [parcelInput, fmsTimeInput, cctvTimeInput, destInput]) el.addEventListener('input', onFormChange);
// A different parcel number changes the JPG header and file names.
parcelInput.addEventListener('input', invalidateEvidence);
onFormChange();
renderChosen();
renderFmsStatus();

if (import.meta.env.DEV) {
  Object.assign(window, { __cctv: { loadFile, setFms, fmsData, annot, vc } });
}
