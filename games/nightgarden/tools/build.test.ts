import { it } from 'vitest';
import { buildProject } from '../src/build';
import { CHAPTERS } from '../src/rooms';

/** Writes games/nightgarden/project from the rooms, the scripts, the screens and the art the studio saved. */
it('build the Nightgarden project', () => {
  const { rooms, dir } = buildProject(CHAPTERS);
  process.stdout.write(`Built ${rooms.length} rooms in ${CHAPTERS.length} chapters into ${dir}\n`);
});
