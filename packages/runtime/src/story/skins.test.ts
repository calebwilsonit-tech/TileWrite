import { describe, expect, it } from 'vitest';
import { C } from '../scene/components';
import { Entity } from '../scene/world';
import { SkinsFileSchema, applySkin, availableSkins, newSkin, skinUnlocked } from './skins';

function player(): Entity {
  const e = new Entity(1, 'Player');
  e.set(C.Sprite, { color: 0x112233, asset: undefined });
  return e;
}

describe('skins', () => {
  it('are always there, or unlock by a variable or an item', () => {
    const always = newSkin('red', 'Red');
    const flag = { ...newSkin('gold', 'Gold'), unlock: { kind: 'variable' as const, name: 'beat_boss', atLeast: 1 } };
    const item = { ...newSkin('cape', 'Cape'), unlock: { kind: 'item' as const, item: 'cape' } };
    expect(skinUnlocked(always, {})).toBe(true);
    expect(skinUnlocked(flag, {})).toBe(false);
    expect(skinUnlocked(flag, { beat_boss: true })).toBe(true);
    expect(skinUnlocked(flag, { beat_boss: 0 })).toBe(false);
    const has = (counts: Record<string, number>): { count(id: string): number } => ({ count: (id) => counts[id] ?? 0 });
    expect(skinUnlocked(item, {})).toBe(false);
    expect(skinUnlocked(item, {}, has({}))).toBe(false);
    expect(skinUnlocked(item, {}, has({ cape: 1 }))).toBe(true);
    expect(availableSkins([always, flag, item], { beat_boss: 2 }).map((s) => s.id)).toEqual(['red', 'gold']);
  });

  it('recolour the player and give the original look back', () => {
    const e = player();
    const skin = { ...newSkin('red', 'Red'), color: 0xff0000 };
    expect(applySkin(e, skin)).toBe(true);
    expect(e.get<{ color: number }>(C.Sprite)!.color).toBe(0xff0000);
    expect(applySkin(e, skin)).toBe(false); // already worn: nothing changes
    expect(applySkin(e, undefined)).toBe(true);
    expect(e.get<{ color: number }>(C.Sprite)!.color).toBe(0x112233);
  });

  it('swap in a drawn sprite and its animator', () => {
    const e = player();
    e.set('animator', { asset: 'hero' });
    applySkin(e, { ...newSkin('knight', 'Knight'), sprite: 'knight' });
    expect(e.get<{ asset: string }>(C.Sprite)!.asset).toBe('knight');
    expect(e.get<{ asset: string }>('animator')!.asset).toBe('knight');
    applySkin(e, undefined);
    expect(e.get<{ asset: string }>('animator')!.asset).toBe('hero');
  });

  it('are validated when loaded', () => {
    expect(SkinsFileSchema.safeParse({ skins: [{ id: 'bad id', name: 'x' }] }).success).toBe(false);
    expect(SkinsFileSchema.parse({ skins: [{ id: 'ok', name: 'Ok' }] }).skins[0]!.unlock).toEqual({ kind: 'always' });
  });
});
