import { Container, Graphics, RenderTexture, Sprite as PixiSprite, type Renderer } from 'pixi.js';
import { gridToScreen, type IsoConfig, type ScreenLayer, type ScreenLayerFrame } from '@tilewright/runtime';
import { visibilityPolygon, type LightingModel } from './model';

const RINGS = 14;
const RAYS = 72;

/**
 * Draws darkness with soft, shadow-casting lights. Darkness is painted into an off-screen texture and the
 * lights are "erased" from it (so overlapping lights add up); a faint additive glow gives lights their colour.
 * The result is two display objects the renderer puts above the world.
 */
export class LightingLayer implements ScreenLayer {
  /** Additive coloured glow (under the darkness). */
  readonly glow = new Graphics();
  /** The darkness (above the glow). */
  readonly darkness = new PixiSprite();
  private readonly scene = new Container();
  private readonly bg = new Graphics();
  private readonly holes = new Graphics();
  private rt: RenderTexture | null = null;

  constructor() {
    this.glow.blendMode = 'add';
    this.holes.blendMode = 'erase';
    this.scene.addChild(this.bg, this.holes);
    this.glow.visible = false;
    this.darkness.visible = false;
  }

  get objects(): Container[] {
    return [this.glow, this.darkness];
  }

  private lights = 0;

  /** For the profiler line. */
  stat(): string {
    return `${this.lights} lights`;
  }

  /** The layer the renderer draws from what the lighting system left each tick. */
  update(frame: ScreenLayerFrame): void {
    this.draw(frame.renderer, frame.data as LightingModel, frame.iso, frame.view, frame.width, frame.height);
  }

  hide(): void {
    this.lights = 0;
    this.glow.visible = false;
    this.darkness.visible = false;
  }

  /**
   * @param view Where the world sits on screen: position of the world container and its zoom.
   */
  private draw(renderer: Renderer, model: LightingModel, iso: IsoConfig, view: { x: number; y: number; zoom: number }, width: number, height: number): void {
    this.lights = model.lights.length;
    const anyDark = model.sceneDarkness > 0 || model.regions.some((r) => r.darkness > 0);
    if (!anyDark) {
      this.hide();
      return;
    }
    if (!this.rt || this.rt.width !== width || this.rt.height !== height) {
      this.rt?.destroy(true);
      this.rt = RenderTexture.create({ width, height });
      this.darkness.texture = this.rt;
    }
    const toScreen = (gx: number, gy: number, gh: number): { x: number; y: number } => {
      const p = gridToScreen(gx, gy, gh, iso);
      return { x: p.x * view.zoom + view.x, y: p.y * view.zoom + view.y };
    };

    const bg = this.bg.clear();
    if (model.sceneDarkness > 0) bg.rect(0, 0, width, height).fill({ color: 0x05060c, alpha: model.sceneDarkness });
    for (const r of model.regions) {
      if (r.darkness <= 0) continue;
      const c = [toScreen(r.x, r.y, 0), toScreen(r.x + r.w, r.y, 0), toScreen(r.x + r.w, r.y + r.h, 0), toScreen(r.x, r.y + r.h, 0)];
      bg.poly(c.flatMap((p) => [p.x, p.y])).fill({ color: 0x05060c, alpha: r.darkness });
    }

    const holes = this.holes.clear();
    const glow = this.glow.clear();
    for (const l of model.lights) {
      if (l.intensity <= 0 || l.radius <= 0) continue;
      const full = visibilityPolygon(model, l, l.radius, RAYS);
      const lens = full.map((p) => Math.hypot(p.x - l.x, p.y - l.y));
      const dirs = full.map((p, i) => ({ x: lens[i]! > 0 ? (p.x - l.x) / lens[i]! : 0, y: lens[i]! > 0 ? (p.y - l.y) / lens[i]! : 0 }));
      for (let k = 1; k <= RINGS; k++) {
        const r = (k / RINGS) * l.radius;
        const pts = dirs.flatMap((d, i) => {
          const len = Math.min(lens[i]!, r);
          const s = toScreen(l.x + d.x * len, l.y + d.y * len, l.h);
          return [s.x, s.y];
        });
        holes.poly(pts).fill({ color: 0xffffff, alpha: 0.13 * l.intensity });
        glow.poly(pts).fill({ color: l.color, alpha: 0.011 * l.intensity });
      }
    }

    renderer.render({ container: this.scene, target: this.rt, clear: true, clearColor: [0, 0, 0, 0] });
    this.darkness.visible = true;
    this.glow.visible = true;
  }

  destroy(): void {
    this.rt?.destroy(true);
    this.rt = null;
  }
}
