// Anonymous usage counts via GoatCounter (no cookies, no personal data): page views with
// country/region, plus how often each button is used. Never sends parcel/LT numbers or names.
// Set the site code (the "xxx" in https://xxx.goatcounter.com) to turn it on; empty = off.
export const GOATCOUNTER_CODE = 'bangz';

declare global {
  interface Window {
    goatcounter?: { count?: (o: { path: string; title?: string; event?: boolean }) => void; no_onload?: boolean };
  }
}

export function initStats(): void {
  if (!GOATCOUNTER_CODE || import.meta.env.DEV) return; // don't count local testing
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
  document.head.append(s);
}

// Counts one use of a feature, e.g. track('zip'). Shown under "Events" in GoatCounter.
export function track(name: string): void {
  window.goatcounter?.count?.({ path: name, title: name, event: true });
}
