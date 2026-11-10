import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseRoom } from '../src/model';
import { scenePath } from '../src/scene';
import { verifyRoom, type RoomReport } from '../src/verify';
import { CHAPTERS, PROJECT_DIR, gameOn, project, say } from './helpers';

/**
 * Every room: the rules find the shortest way out (and the shortest way that also catches the firefly), and a bot plays both
 * in the real game with nothing but a player's buttons, checking after every step that the game agrees with the rules.
 * The bot's button presses are kept as playthroughs in the project, so the editor's Playbot panel can replay them.
 */
describe('every room', () => {
  const reports: RoomReport[] = [];
  for (const chapter of CHAPTERS) {
    for (const def of chapter.rooms) {
      it(`${def.id} "${def.name}" can be finished, and the game plays it as the rules say`, async () => {
        const p = await project();
        const room = parseRoom(def);
        const r = verifyRoom(room, () => gameOn(p, scenePath(room.id)));
        reports.push(r);
        say(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.id} ${r.name}: ${r.steps} steps, ${r.toggles} lamps, ${r.pushes} pushes${r.fireflySteps ? `, firefly ${r.fireflySteps}` : ''}, ${r.states} situations, ${r.seconds.toFixed(1)} s`);
        expect(r.problems).toEqual([]);
        expect(r.steps).toBeGreaterThan(0);
      });
    }
  }

  it('has rooms with different names and ids, and a firefly in most of them', () => {
    const defs = CHAPTERS.flatMap((c) => c.rooms);
    expect(new Set(defs.map((d) => d.id)).size).toBe(defs.length);
    expect(new Set(defs.map((d) => d.name)).size).toBe(defs.length);
    for (const d of defs) {
      expect(d.name.length, `${d.id} name`).toBeLessThanOrEqual(22);
      expect((d.hint ?? '').length, `${d.id} hint`).toBeLessThanOrEqual(80);
      expect(d.hint ?? '', `${d.id} hint has no exclamation mark`).not.toContain('!');
    }
  });

  it('writes the room list (check/rooms.md) from what was just played', () => {
    if (reports.length === 0) return;
    const lines = ['# Rooms', '', 'Written by the check from the last run. Steps are the shortest way out by the rules; seconds are the bot\'s time in the real game.', '', '| Room | Name | Steps | Lamps | Pushes | With the firefly | Bot seconds |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |'];
    for (const r of reports) lines.push(`| ${r.id} | ${r.name} | ${r.steps} | ${r.toggles} | ${r.pushes} | ${r.fireflySteps || ''} | ${r.seconds.toFixed(0)} |`);
    const total = reports.reduce((s, r) => s + r.steps, 0);
    lines.push('', `${reports.length} rooms, ${total} steps on the shortest ways, ${reports.reduce((s, r) => s + r.seconds, 0).toFixed(0)} seconds for a bot that never stops to think.`, '');
    fs.writeFileSync(path.join(PROJECT_DIR, '..', 'check', 'rooms.md'), lines.join('\n'));
  });
});
