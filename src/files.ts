import JSZip from 'jszip';

export interface OutFile {
  path: string; // path inside the ZIP, e.g. "TH123/TH123_Evidence.jpg"
  blob: Blob;
}

export async function buildZip(files: OutFile[]): Promise<Blob> {
  const zip = new JSZip();
  // JPG/MP4 are already compressed; STORE keeps zipping fast for large clips.
  for (const f of files) zip.file(f.path, f.blob, { compression: 'STORE' });
  return zip.generateAsync({ type: 'blob' });
}

declare global {
  interface Window {
    __cctvSaveToDisk?: boolean;
  }
}

export function download(blob: Blob, name: string): void {
  // Dev-only test hook: mirror the download into ./test-output via the Vite dev server.
  if (import.meta.env.DEV && window.__cctvSaveToDisk) {
    void fetch(`/__save?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
