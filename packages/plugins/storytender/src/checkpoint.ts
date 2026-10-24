import { C, type Entity, type TransformIso, type SimContext, type VariableValue, behaviorDef, setOutput, interactedBy } from '@tilewright/plugin-sdk';
import { heal } from '@tilewright/plugin-combat';


const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);

function nearestPlayer(ctx: SimContext, e: Entity, reach: number): Entity | undefined {
  const t = transform(e);
  return ctx.world.withTag('player').find((p) => {
    const pt = p.get<TransformIso>(C.Transform);
    return !!pt && Math.hypot(pt.x - t.x, pt.y - t.y) <= reach;
  });
}

function hint(e: Entity, text: string | null): void {
  const cur = e.get<{ text: string; color: number }>('label');
  if (text === null) {
    if (cur && cur.color === 0xbfe3ff) e.remove('label');
    return;
  }
  if (!cur || cur.text !== text) e.set('label', { text, color: 0xbfe3ff, size: 12, bold: false, italic: false, underline: false, lift: 0.35 });
}

// ---------- lantern post (checkpoint) ----------

export interface Checkpoint {
  /** Shown in the travel list. */
  name: string;
  reach: number;
  /** How far a lit lantern shines. */
  lightRadius: number;
  /** Resting restores all health. */
  heals: boolean;
}

const litKey = (scene: string, id: string): string => `lit:${scene}:${id}`;

export interface LitPost {
  scene: string;
  id: string;
  name: string;
  x: number;
  y: number;
  h: number;
}

/** Every lantern the player has lit, in any scene (read from the saved variables). */
export function litPosts(vars: Record<string, VariableValue>): LitPost[] {
  const out: LitPost[] = [];
  for (const [k, v] of Object.entries(vars)) {
    if (!k.startsWith('lit:') || typeof v !== 'string') continue;
    const rest = k.slice(4);
    const split = rest.lastIndexOf(':');
    const [name = '', x = '0', y = '0', h = '0'] = v.split('|');
    out.push({ scene: rest.slice(0, split), id: rest.slice(split + 1), name, x: Number(x), y: Number(y), h: Number(h) });
  }
  return out.sort((a, b) => a.scene.localeCompare(b.scene) || a.name.localeCompare(b.name));
}

export const checkpoint = behaviorDef<Checkpoint>({
  id: 'checkpoint',
  name: 'Lantern Post (checkpoint)',
  category: 'Story',
  description:
    'The player presses Interact (E) next to it to light it and rest. Resting heals, and if the player is defeated they return to the last post they rested at. Lit posts are listed in the Travel menu so the player can fast travel between them.',
  phase: 'control',
  defaults: { name: 'Lantern', reach: 1.6, lightRadius: 5, heals: true },
  fields: [
    { key: 'name', label: 'Name (shown in the travel list)', type: 'text' },
    { key: 'reach', label: 'How close the player must be (cells)', type: 'number', min: 0.5, max: 6, step: 0.1 },
    { key: 'lightRadius', label: 'How far it shines when lit (cells)', type: 'number', min: 1, max: 15, step: 0.5 },
    { key: 'heals', label: 'Resting heals the player fully', type: 'boolean' },
  ],
  inputs: [],
  outputs: [{ name: 'lit', label: 'Is lit' }],
  requires: { collider: { w: 0.5, d: 0.5, height: 1.4, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } },
  summary: (s) => `"${s.name}": rest here, and come back here when defeated.`,
  update(ctx, e, s) {
    const id = e.get<{ sceneId: string }>('meta')?.sceneId ?? String(e.id);
    const key = litKey(ctx.runtime.scene, id);
    const t = transform(e);
    const lit = typeof ctx.runtime.vars[key] === 'string';
    const near = nearestPlayer(ctx, e, s.reach);
    if (lit && !e.has('light')) e.set('light', { radius: s.lightRadius, intensity: 1, color: 'warm', shadows: true, flicker: 0.2, mode: 'always' });
    const sp = e.get<{ color: number }>(C.Sprite);
    if (sp) sp.color = lit ? 0xffc866 : 0x6b6f7a;
    if (near && !ctx.runtime.dialogue) hint(e, lit ? 'E: rest' : 'E: light the lantern');
    else hint(e, null);
    if (interactedBy(ctx, e, s.reach, 'checkpoint') && near) {
      const spot = { x: t.x, y: t.y + 1, h: t.h };
      if (!lit) {
        ctx.runtime.vars[key] = `${s.name}|${spot.x}|${spot.y}|${spot.h}`;
        ctx.events.emit('message', { text: ctx.assets.strings.fmt('{name} is lit.', { name: s.name }) });
        ctx.events.emit('lantern-lit', { entity: e.id, name: s.name });
      } else ctx.events.emit('message', { text: ctx.assets.strings.fmt('Rested at {name}.', { name: s.name }) });
      ctx.runtime.checkpoint = { scene: ctx.runtime.scene, x: spot.x, y: spot.y, h: spot.h, name: s.name };
      if (s.heals) {
        const hs = near.get<{ max?: number }>('health');
        if (hs) heal(ctx, near, hs.max ?? 99);
      }
      ctx.events.emit('rested', { entity: e.id, name: s.name });
    }
    setOutput(e, 'lit', typeof ctx.runtime.vars[key] === 'string');
  },
});
