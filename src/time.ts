// Clock times typed by the user ("20:52:25", "205225", "20.52.25") → "HH:MM:SS".
// Phase 2: an OCR reader of the on-screen CCTV clock should return the same format.
export function normalizeTime(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let h: number, m: number, s: number;
  const parts = input.trim().split(/[:.\s]+/).filter(Boolean);
  if (parts.length === 3) {
    [h, m, s] = parts.map(Number);
  } else if (digits.length === 6) {
    h = +digits.slice(0, 2);
    m = +digits.slice(2, 4);
    s = +digits.slice(4, 6);
  } else {
    return null;
  }
  if ([h, m, s].some(Number.isNaN) || h > 23 || m > 59 || s > 59) return null;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatSeconds(t: number): string {
  if (!Number.isFinite(t)) return '0.00';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(2).padStart(5, '0')}` : s.toFixed(2);
}
