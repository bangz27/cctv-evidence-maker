import type { OutFile } from './files';

// Optional supporting photos. They go into the ZIP as the original files, untouched.
interface Slot {
  key: string;
  label: string;
  fileTag: string; // used in the file name: {parcel}_{fileTag}.jpg
}

export const SLOTS: Slot[] = [
  { key: 'runsheet', label: 'Runsheet', fileTag: 'Runsheet' },
  { key: 'truck', label: 'รูปท้ายรถ', fileTag: 'TruckRear' },
  { key: 'seal', label: 'รูป Seal', fileTag: 'Seal' },
];

interface Item {
  file: File;
  url: string; // object URL for the thumbnail
}

export class Attachments {
  private items = new Map<string, Item[]>(SLOTS.map((s) => [s.key, []]));

  constructor(
    private root: HTMLElement,
    private onChange: () => void = () => {},
  ) {
    this.render();
  }

  get count(): number {
    let n = 0;
    for (const list of this.items.values()) n += list.length;
    return n;
  }

  add(key: string, files: Iterable<File>): number {
    const list = this.items.get(key)!;
    let added = 0;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      list.push({ file, url: URL.createObjectURL(file) });
      added++;
    }
    if (added) this.changed();
    return added;
  }

  remove(key: string, index: number): void {
    const [item] = this.items.get(key)!.splice(index, 1);
    if (item) URL.revokeObjectURL(item.url);
    this.changed();
  }

  // {parcel}/{parcel}_Seal.jpg, or _Seal_1.jpg, _Seal_2.jpg ... when a slot has several.
  zipEntries(parcel: string): OutFile[] {
    const out: OutFile[] = [];
    for (const slot of SLOTS) {
      const list = this.items.get(slot.key)!;
      list.forEach(({ file }, i) => {
        const n = list.length > 1 ? `_${i + 1}` : '';
        out.push({ path: `${parcel}/${parcel}_${slot.fileTag}${n}.${extOf(file)}`, blob: file });
      });
    }
    return out;
  }

  private changed(): void {
    this.render();
    this.onChange();
  }

  private render(): void {
    this.root.innerHTML = '';
    for (const slot of SLOTS) {
      const list = this.items.get(slot.key)!;
      const el = document.createElement('div');
      el.className = 'attach-slot';
      el.innerHTML = `
        <div class="attach-head">
          <strong></strong>
          <label class="btn small">+ เพิ่มรูป<input type="file" accept="image/*" multiple hidden /></label>
        </div>
        <div class="attach-thumbs"></div>`;
      el.querySelector('strong')!.textContent = list.length ? `${slot.label} (${list.length})` : slot.label;
      const input = el.querySelector('input')!;
      input.addEventListener('change', () => {
        if (input.files) this.add(slot.key, input.files);
      });
      const thumbs = el.querySelector('.attach-thumbs')!;
      if (!list.length) {
        const empty = document.createElement('span');
        empty.className = 'attach-empty';
        empty.textContent = 'ยังไม่มีรูป';
        thumbs.append(empty);
      }
      list.forEach((item, i) => {
        const t = document.createElement('div');
        t.className = 'attach-thumb';
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.file.name;
        img.title = item.file.name;
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'ลบรูปนี้';
        del.onclick = () => this.remove(slot.key, i);
        t.append(img, del);
        thumbs.append(t);
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.classList.add('over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation(); // keep the page-level drop handler (video loader) out of it
        el.classList.remove('over');
        if (e.dataTransfer) this.add(slot.key, e.dataTransfer.files);
      });
      this.root.append(el);
    }
  }
}

function extOf(file: File): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(file.name);
  if (m) return m[1].toLowerCase();
  const sub = file.type.split('/')[1] ?? 'jpg';
  return sub === 'jpeg' ? 'jpg' : sub;
}
