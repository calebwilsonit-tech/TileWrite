import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseSprite } from '@tilewright/runtime';
import { checkProject } from '../../../packages/editor/src/renderer/project/check';
import { loadProjectInput, loadSkins, loadUiLayout, loadWorldMap } from '../../../packages/editor/src/renderer/project/story';
import { loadLanguages } from '../../../packages/editor/src/renderer/project/localization';
import { nodeFs } from '../../../compat/harness/nodefs';
import { INK } from '../art/draw';
import { PICTURES } from '../art/pictures';
import { TILES } from '../art/tiles';
import { PROJECT_DIR, project, say } from './helpers';

const spritesDir = path.join(PROJECT_DIR, 'assets', 'sprites');
const spriteNames = (): string[] => fs.readdirSync(spritesDir).filter((f) => f.endsWith('.sprite.json')).map((f) => f.replace('.sprite.json', ''));

describe('the project', () => {
  it('opens with nothing to complain about: every scene, script, screen and table loads', async () => {
    const p = await project();
    expect(p.problems).toEqual([]);
    expect(p.scripts.size).toBeGreaterThanOrEqual(8);
    expect(p.project.scenes.length).toBe(p.scenes.size);
  });

  it('passes the editor\'s own whole-project check (what Export insists on)', async () => {
    const p = await project();
    const [languages, skins, worldMap, input, layout] = await Promise.all([loadLanguages(nodeFs, PROJECT_DIR), loadSkins(nodeFs, PROJECT_DIR), loadWorldMap(nodeFs, PROJECT_DIR), loadProjectInput(nodeFs, PROJECT_DIR), loadUiLayout(nodeFs, PROJECT_DIR)]);
    const problems = await checkProject(nodeFs, PROJECT_DIR, p.project, p.prefabs, { dialogues: p.dialogues, cutscenes: p.cutscenes }, new Set(spriteNames()), new Set(), languages.languages, skins.skins, p.data, undefined, worldMap.map, { input: input.input, layout: layout.layout, tables: p.tables });
    for (const m of problems) say(`  ${m.severity}: ${m.scene} ${m.message}`);
    expect(problems.filter((m) => m.severity === 'error').map((m) => `${m.scene}: ${m.message}`)).toEqual([]);
    expect(problems.filter((m) => m.severity === 'warning').map((m) => `${m.scene}: ${m.message}`)).toEqual([]);
  });

  it('has every picture the art list names, drawn in the studio, with a feet point and only the inks of the design', () => {
    const inks = new Set(Object.values(INK).map((h) => h.toLowerCase()));
    const want = [...PICTURES.map((p) => p.name), ...TILES.flatMap((t) => [t.name, `${t.name}_top`, `${t.name}_left`, `${t.name}_right`])];
    const have = new Set(spriteNames());
    expect(want.filter((n) => !have.has(n)), 'pictures that have not been drawn (npm run nightgarden:art)').toEqual([]);
    for (const name of want) {
      const r = parseSprite(JSON.parse(fs.readFileSync(path.join(spritesDir, `${name}.sprite.json`), 'utf8')));
      expect(r.ok, `${name}: ${r.ok ? '' : r.error}`).toBe(true);
      if (!r.ok) continue;
      const sprite = r.value;
      const used = new Set<number>();
      for (const f of sprite.frames) for (const cel of Object.values(f.cels)) for (const m of cel.matchAll(/(\d+)(?:x\d+)?/g)) used.add(Number(m[1]));
      void used;
      const picture = PICTURES.find((p) => p.name === name);
      if (picture) {
        expect([sprite.width, sprite.height], `${name} size`).toEqual([picture.w, picture.h]);
        expect([sprite.origin.x, sprite.origin.y], `${name} feet point`).toEqual(picture.feet ?? [Math.floor(picture.w / 2), picture.h - 1]);
        expect(sprite.frames.length, `${name} frames`).toBe(picture.frames.length);
        expect(sprite.clips.map((c) => c.name), `${name} animations`).toEqual((picture.clips ?? []).map((c) => c.name));
      }
    }
    // colours: every colour a picture really uses is one of the inks
    for (const name of want) {
      const sprite = JSON.parse(fs.readFileSync(path.join(spritesDir, `${name}.sprite.json`), 'utf8')) as { palette: string[] };
      const picture = PICTURES.find((p) => p.name === name) ?? TILES.find((t) => name === t.name || name.startsWith(`${t.name}_`));
      const n = picture ? new Set(picture.frames.flatMap((f) => f.ops.flatMap((o) => ('c' in o ? [o.c] : [])))).size : 0;
      const firstN = sprite.palette.slice(1, 1 + n).map((c) => c.slice(0, 7).toLowerCase());
      if (PICTURES.some((p) => p.name === name)) expect(firstN.filter((c) => !inks.has(c)), `${name} uses colours that are not inks`).toEqual([]);
    }
  });

  it('uses only pictures that exist, in every scene and on every screen', async () => {
    const p = await project();
    const have = new Set(spriteNames());
    const missing = new Set<string>();
    for (const [file, scene] of p.scenes) for (const e of scene.entities) {
      const a = (e.components.sprite as { asset?: string } | undefined)?.asset;
      if (a && !have.has(a)) missing.add(`${file}: ${e.name} -> ${a}`);
    }
    const walk = (n: { sprite: string; name: string; children: unknown[] }): void => {
      if (n.sprite && !have.has(n.sprite)) missing.add(`screen widget ${n.name} -> ${n.sprite}`);
      (n.children as (typeof n)[]).forEach(walk);
    };
    for (const s of p.ui.screens) walk(s.root as never);
    // the pictures scripts swap to
    for (const n of ['lamp_on', 'lamp_off', 'wirelamp_on', 'wirelamp_off', 'gate_open', 'gate_half', 'gate_shut', 'plate_up', 'plate_down', ...[0, 1, 2, 3].flatMap((i) => [`moonbloom_${i}`, `duskcap_${i}`])]) if (!have.has(n)) missing.add(`script picture ${n}`);
    expect([...missing]).toEqual([]);
  });
});
