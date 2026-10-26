export const HEVC_MSG =
  'เบราว์เซอร์นี้เปิด H.265 ไม่ได้ ลองใช้ Edge/Chrome ที่รองรับ HEVC หรือแปลงไฟล์เป็น H.264 ก่อน';

const hasRVFC = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

// Wraps the <video>: loading via object URL (no full-file read), seeking and frame stepping.
export class VideoController {
  fps = 25;
  private url: string | null = null;

  constructor(readonly el: HTMLVideoElement) {}

  get width(): number {
    return this.el.videoWidth;
  }
  get height(): number {
    return this.el.videoHeight;
  }
  get duration(): number {
    return Number.isFinite(this.el.duration) ? this.el.duration : 0;
  }

  async load(file: Blob): Promise<void> {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(file);
    const el = this.el;
    el.src = this.url;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        el.removeEventListener('loadeddata', ok);
        el.removeEventListener('error', bad);
      };
      // HEVC in a browser without the decoder either errors, or loads with audio only (videoWidth 0).
      const ok = () => {
        cleanup();
        if (el.videoWidth > 0) resolve();
        else reject(new Error(HEVC_MSG));
      };
      const bad = () => {
        cleanup();
        reject(new Error(HEVC_MSG));
      };
      el.addEventListener('loadeddata', ok);
      el.addEventListener('error', bad);
      el.load();
    });
    await this.measureFps();
  }

  // Plays a few frames muted and takes the median frame interval. Falls back to the current fps.
  private async measureFps(): Promise<void> {
    if (!hasRVFC) return;
    const el = this.el;
    const times: number[] = [];
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      const cb: VideoFrameRequestCallback = (_now, meta) => {
        times.push(meta.mediaTime);
        if (times.length < 15) el.requestVideoFrameCallback(cb);
        else {
          clearTimeout(timer);
          resolve();
        }
      };
      el.requestVideoFrameCallback(cb);
      el.play().catch(() => resolve());
    });
    el.pause();
    await this.seek(0);
    const diffs = times
      .slice(1)
      .map((t, i) => t - times[i])
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    if (diffs.length >= 3) {
      const fps = Math.round(1 / diffs[Math.floor(diffs.length / 2)]);
      if (fps >= 1 && fps <= 120) this.fps = fps;
    }
  }

  seek(t: number): Promise<void> {
    const el = this.el;
    const target = Math.min(Math.max(0, t), this.duration || 0);
    return new Promise((resolve) => {
      if (Math.abs(el.currentTime - target) < 1e-4 && !el.seeking) return resolve();
      el.addEventListener('seeked', () => resolve(), { once: true });
      el.currentTime = target;
    });
  }

  stepFrames(n: number): Promise<void> {
    this.el.pause();
    // Land in the middle of the target frame so rounding never shows the neighbour frame.
    const frame = Math.floor(this.el.currentTime * this.fps + 1e-3) + n;
    return this.seek((frame + 0.5) / this.fps);
  }

  stepSeconds(s: number): Promise<void> {
    this.el.pause();
    return this.seek(this.el.currentTime + s);
  }

  get frameIndex(): number {
    return Math.floor(this.el.currentTime * this.fps + 1e-3);
  }

  // Copy of the frame currently shown, at the video's native resolution.
  captureFrame(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    c.getContext('2d')!.drawImage(this.el, 0, 0, c.width, c.height);
    return c;
  }
}
