// Persists only the typed case fields. Video and images are never stored.
const KEY = 'cctv-evidence-maker:v2';

export interface SavedForm {
  parcel: string;
  fmsTime: string;
  cctvTime: string;
  dest: string;
}

export function loadForm(): Partial<SavedForm> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<SavedForm>) : {};
  } catch {
    return {};
  }
}

export function saveForm(form: SavedForm): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(form));
  } catch {
    // storage unavailable (private mode, quota) - the app works without it
  }
}
