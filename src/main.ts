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
const toInput = $<HTMLInputElement>('toInput');
const fmsTimeInput = $<HTMLInputElement>('fmsTimeInput');
const cctvTimeInput = $<HTMLInputElement>('cctvTimeInput');
const timeMatch = $('timeMatch');
const destInput = $<HTMLInputElement>('destInput');
const parcelsInput = $<HTMLTextAreaElement>('parcelsInput');
const parcelList = $('parcelList');
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
interface ParcelData {
  fms?: ImageBitmap;
  fmsName?: string;
  point?: Point; // FMS image pixels
  evidence?: Blob;
}

const vc = new VideoController(videoEl);
const annot = new Annotator(overlay);
const parcels = new Map<string, ParcelData>();
let activeParcel = '';
let chosen: { canvas: HTMLCanvasElement; time: number } | null = null;
let clip: { blob: Blob; format: ClipFormat; stale: boolean } | null = null;
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
function parcelIds(): string[] {
  const ids = parcelsInput.value
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(ids)];
}

function caseData() {
  return {
    to: toInput.value.trim().toUpperCase(),
    fmsTime: normalizeTime(fmsTimeInput.value),
    cctvTime: normalizeTime(cctvTimeInput.value),
    dest: destInput.value.trim().toUpperCase(),
  };
}

function onFormChange(): void {
  saveForm({
    to: toInput.value,
    fmsTime: fmsTimeInput.value,
    cctvTime: cctvTimeInput.value,
    dest: destInput.value,
    parcels: parcelsInput.value,
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
  syncParcels();
}

function syncParcels(): void {
  const ids = parcelIds();
  for (const id of ids) if (!parcels.has(id)) parcels.set(id, {});
  for (const id of [...parcels.keys()]) if (!ids.includes(id)) parcels.delete(id);
  if (!parcels.has(activeParcel)) activeParcel = ids[0] ?? '';
  renderParcels();
  renderFms();
}

function renderParcels(): void {
  parcelList.innerHTML = '';
  if (!parcels.size) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'ยังไม่มีเลขพัสดุ — กรอกในช่อง "เลขพัสดุใน TO นี้"';
    parcelList.append(li);
    return;
  }
  for (const [id, p] of parcels) {
    const li = document.createElement('li');
    li.className = id === activeParcel ? 'active' : '';
    li.innerHTML = `
      <span class="pid"></span>
      <span class="chips">
        <span class="chip ${p.fms ? 'ok' : ''}">${p.fms ? '✔' : '✖'} FMS</span>
        <span class="chip ${p.point ? 'ok' : ''}">${p.point ? '✔' : '–'} จุดลูกศร</span>
        <span class="chip ${p.evidence ? 'ok' : ''}">${p.evidence ? '✔' : '–'} JPG</span>
      </span>
      <label class="btn small">เลือกไฟล์<input type="file" accept="image/*" hidden /></label>`;
    li.querySelector('.pid')!.textContent = id;
    li.addEventListener('click', () => {
      if (activeParcel === id) return;
      activeParcel = id;
      renderParcels();
      renderFms();
    });
    const input = li.querySelector('input')!;
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) void setFms(id, f);
    });
    parcelList.append(li);
  }
}

async function setFms(id: string, blob: Blob, name = 'clipboard'): Promise<void> {
  const p = parcels.get(id);
  if (!p) return;
  try {
    p.fms = await createImageBitmap(blob);
  } catch {
    showMsg('อ่านไฟล์ภาพ FMS ไม่ได้', 'error');
    return;
  }
  p.fmsName = blob instanceof File ? blob.name : name;
  p.point = undefined;
  p.evidence = undefined;
  activeParcel = id;
  renderParcels();
  renderFms();
}

function renderFms(): void {
  const p = parcels.get(activeParcel);
  if (!p?.fms) {
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
    ? `${activeParcel}: ✔ ตั้งจุดลูกศรแล้ว (คลิกใหม่เพื่อย้าย)`
    : `${activeParcel}: คลิกบนภาพตรงบรรทัด FMHub_LHPacking เพื่อกำหนดจุดที่ลูกศรชี้`;
}

fmsCanvas.addEventListener('click', (e) => {
  const p = parcels.get(activeParcel);
  if (!p?.fms) return;
  const r = fmsCanvas.getBoundingClientRect();
  p.point = {
    x: ((e.clientX - r.left) * fmsCanvas.width) / r.width,
    y: ((e.clientY - r.top) * fmsCanvas.height) / r.height,
  };
  p.evidence = undefined;
  renderParcels();
  renderFms();
});

document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  const blob = item?.getAsFile();
  if (!blob) return;
  e.preventDefault();
  if (!activeParcel) {
    showMsg('กรอกเลขพัสดุก่อน แล้วค่อยวางภาพ FMS', 'warn');
    return;
  }
  void setFms(activeParcel, blob);
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
  for (const p of parcels.values()) p.evidence = undefined;
  renderParcels();
  renderChosen();
  renderFiles();
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
  for (const p of parcels.values()) p.evidence = undefined;
  renderChosen();
  renderParcels();
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
  for (const p of parcels.values()) p.evidence = undefined;
  if (clip) clip.stale = true;
  renderParcels();
  renderFiles();
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
  if (!c.to) errs.push('ยังไม่ได้กรอก TO number');
  if (!c.fmsTime) errs.push('เวลา FMHub_LHPacking ไม่ถูกต้อง (HH:MM:SS)');
  if (!c.cctvTime) errs.push('ยังไม่ได้กรอกเวลา CCTV ที่อ่านจากมุมจอ (HH:MM:SS)');
  return errs;
}

async function makeEvidence(id: string): Promise<Blob> {
  const p = parcels.get(id)!;
  const c = caseData();
  await ensureFonts();
  const canvas = renderEvidence({
    parcel: id,
    to: c.to,
    cctvTime: c.cctvTime!,
    fmsTime: c.fmsTime!,
    frame: chosen!.canvas,
    shapes: annot.shapes,
    fms: p.fms!,
    point: p.point,
  });
  p.evidence = await toJpeg(canvas);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(p.evidence);
  evidencePreview.src = previewUrl;
  evidencePreview.hidden = false;
  return p.evidence;
}

function noPointNote(ids: string[]): string {
  const missing = ids.filter((id) => !parcels.get(id)?.point);
  return missing.length ? ` · ไม่มีลูกศร (ยังไม่ได้คลิกจุด): ${missing.join(', ')}` : '';
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
    if (!activeParcel) errs.push('ยังไม่มีเลขพัสดุ');
    else if (!parcels.get(activeParcel)?.fms) errs.push(`${activeParcel} ยังไม่มีภาพ FMS`);
    if (errs.length) return showMsg(errs.join('\n'), 'error');
    const blob = await makeEvidence(activeParcel);
    download(blob, `${activeParcel}_Evidence.jpg`);
    renderParcels();
    renderFiles();
    showMsg(`สร้าง ${activeParcel}_Evidence.jpg แล้ว (${formatBytes(blob.size)})${noPointNote([activeParcel])}`, noPointNote([activeParcel]) ? 'warn' : 'ok');
  }),
);

$('makeAllBtn').addEventListener('click', () =>
  guarded(async () => {
    const errs = baseErrors();
    const ready = [...parcels.keys()].filter((id) => parcels.get(id)!.fms);
    const missing = [...parcels.keys()].filter((id) => !parcels.get(id)!.fms);
    if (!ready.length) errs.push('ยังไม่มีเลขพัสดุที่มีภาพ FMS');
    if (errs.length) return showMsg(errs.join('\n'), 'error');
    for (const id of ready) {
      const blob = await makeEvidence(id);
      download(blob, `${id}_Evidence.jpg`);
      await new Promise((r) => setTimeout(r, 300)); // Chrome drops rapid back-to-back downloads
    }
    renderParcels();
    renderFiles();
    const notes = (missing.length ? ` · ข้าม (ไม่มีภาพ FMS): ${missing.join(', ')}` : '') + noPointNote(ready);
    showMsg(`สร้างภาพหลักฐาน ${ready.length} ไฟล์แล้ว${notes}`, notes ? 'warn' : 'ok');
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
    if (!c.to) errs.push('ยังไม่ได้กรอก TO number');
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
        barText: `${c.to} | LHPacking ${c.fmsTime} | ยิงขึ้นรถ Shuttle ไป ${c.dest}`,
        onProgress: (f) => (recordProgress.value = f),
      });
      clip = { ...res, stale: false };
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
  for (const [id, p] of parcels) if (p.evidence) add(`${id}_Evidence.jpg`, p.evidence);
  if (clip) {
    const note = clip.stale ? ' · ⚠ แก้วงหลังอัด อัดใหม่ถ้าต้องการ' : '';
    for (const id of parcels.keys()) add(`CCTV_${id}.${clip.format.ext}`, clip.blob, note);
  }
  if (fileList.childElementCount) resultCard.hidden = false;
}

$('zipBtn').addEventListener('click', () =>
  guarded(async () => {
    const errs = baseErrors();
    const ready = [...parcels.keys()].filter((id) => parcels.get(id)!.fms);
    const missing = [...parcels.keys()].filter((id) => !parcels.get(id)!.fms);
    if (!ready.length) errs.push('ยังไม่มีเลขพัสดุที่มีภาพ FMS');
    if (errs.length) return showMsg(errs.join('\n'), 'error');
    const files: OutFile[] = [];
    for (const id of ready) {
      // Always rebuild so the ZIP matches the current frame, shapes and form.
      files.push({ path: `${id}/${id}_Evidence.jpg`, blob: await makeEvidence(id) });
      if (clip) files.push({ path: `${id}/CCTV_${id}.${clip.format.ext}`, blob: clip.blob });
    }
    const zip = await buildZip(files);
    download(zip, `${caseData().to}_Evidence.zip`);
    renderParcels();
    renderFiles();
    const notes = [
      missing.length ? `ข้าม (ไม่มีภาพ FMS): ${missing.join(', ')}` : '',
      clip ? '' : 'ยังไม่ได้อัดคลิป — ZIP มีแต่ภาพ',
      noPointNote(ready).replace(' · ', ''),
    ].filter(Boolean);
    showMsg(`ZIP ${formatBytes(zip.size)} · ${ready.length} เลขพัสดุ${notes.length ? '\n' + notes.join('\n') : ''}`, notes.length ? 'warn' : 'ok');
  }),
);

// ---------- init ----------
const saved = loadForm();
toInput.value = saved.to ?? '';
fmsTimeInput.value = saved.fmsTime ?? '';
cctvTimeInput.value = saved.cctvTime ?? '';
destInput.value = saved.dest ?? '';
parcelsInput.value = saved.parcels ?? '';
for (const el of [toInput, fmsTimeInput, cctvTimeInput, destInput, parcelsInput]) el.addEventListener('input', onFormChange);
onFormChange();
renderChosen();

if (import.meta.env.DEV) {
  Object.assign(window, { __cctv: { loadFile, setFms, parcels, annot, vc } });
}
