import { Rng } from '../core/rng';

export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Vec2Like {
  x: number;
  y: number;
}

/**
 * Camera in SCREEN-projection space (the pixels gridToScreen produces), so bounds and the deadzone
 * behave the way the player sees them. `x`,`y` is the point shown at the centre of the viewport.
 *
 * Shake uses its own seeded RNG and is purely cosmetic: it is never part of simulation state.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  viewW = 1280;
  viewH = 720;
  /** Half-size of the box (in screen pixels) the target may move in before the camera follows. */
  deadzoneW = 0;
  deadzoneH = 0;
  /** 0..1 per second-ish: fraction of the remaining distance covered each tick. 1 = snap. */
  smoothing = 1;
  bounds: CameraBounds | null = null;

  private shakeAmp = 0;
  private shakeDecay = 0;
  private shakeX = 0;
  private shakeY = 0;
  private readonly shakeRng = new Rng(1234);

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  /** Jump to a point (also clamps to bounds). */
  snapTo(p: Vec2Like): void {
    this.x = p.x;
    this.y = p.y;
    this.clamp();
  }

  /** Move toward `target` only as far as needed to keep it inside the deadzone, then smooth. */
  follow(target: Vec2Like): void {
    let tx = this.x;
    let ty = this.y;
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    if (dx > this.deadzoneW) tx = target.x - this.deadzoneW;
    else if (dx < -this.deadzoneW) tx = target.x + this.deadzoneW;
    if (dy > this.deadzoneH) ty = target.y - this.deadzoneH;
    else if (dy < -this.deadzoneH) ty = target.y + this.deadzoneH;
    const k = Math.min(1, Math.max(0, this.smoothing));
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.clamp();
  }

  /** Start a shake of `amplitude` pixels that dies away over `seconds`. */
  shake(amplitude: number, seconds: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amplitude);
    this.shakeDecay = seconds > 0 ? amplitude / seconds : amplitude;
  }

  /** Advance shake by one tick. Call once per simulation tick (or per frame). */
  update(dt: number): void {
    if (this.shakeAmp > 0) {
      this.shakeX = (this.shakeRng.next() * 2 - 1) * this.shakeAmp;
      this.shakeY = (this.shakeRng.next() * 2 - 1) * this.shakeAmp;
      this.shakeAmp = Math.max(0, this.shakeAmp - this.shakeDecay * dt);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  get shaking(): boolean {
    return this.shakeAmp > 0;
  }

  /** Keep the viewport inside `bounds`; if bounds are smaller than the view, centre on them. */
  clamp(): void {
    const b = this.bounds;
    if (!b) return;
    const halfW = this.viewW / this.zoom / 2;
    const halfH = this.viewH / this.zoom / 2;
    this.x = b.maxX - b.minX <= halfW * 2 ? (b.minX + b.maxX) / 2 : Math.min(Math.max(this.x, b.minX + halfW), b.maxX - halfW);
    this.y = b.maxY - b.minY <= halfH * 2 ? (b.minY + b.maxY) / 2 : Math.min(Math.max(this.y, b.minY + halfH), b.maxY - halfH);
  }

  /** Screen-projection point -> viewport pixel. */
  worldToView(p: Vec2Like): Vec2Like {
    return {
      x: (p.x - this.x - this.shakeX) * this.zoom + this.viewW / 2,
      y: (p.y - this.y - this.shakeY) * this.zoom + this.viewH / 2,
    };
  }

  /** Viewport pixel -> screen-projection point. */
  viewToWorld(p: Vec2Like): Vec2Like {
    return {
      x: (p.x - this.viewW / 2) / this.zoom + this.x + this.shakeX,
      y: (p.y - this.viewH / 2) / this.zoom + this.y + this.shakeY,
    };
  }

  /** Translation to apply to a world container so worldToView holds. */
  get offset(): Vec2Like {
    return {
      x: this.viewW / 2 - (this.x + this.shakeX) * this.zoom,
      y: this.viewH / 2 - (this.y + this.shakeY) * this.zoom,
    };
  }
}
