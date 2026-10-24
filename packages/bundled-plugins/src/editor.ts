import { host } from '@tilewright/plugin-sdk';
import { installEditor as ai } from '@tilewright/plugin-ai/editor';
import { installEditor as combat } from '@tilewright/plugin-combat/editor';
import { installEditor as inventory } from '@tilewright/plugin-inventory/editor';
import { installEditor as lighting } from '@tilewright/plugin-lighting/editor';
import { installEditor as story } from '@tilewright/plugin-story/editor';
import { installEditor as storytender } from '@tilewright/plugin-storytender/editor';

/** The editor parts of the bundled plugins: panels, tools, prefabs, checks and the like. Only the editor imports this file; an exported game never does. */
const EDITOR_PARTS = { ai, combat, inventory, lighting, story, storytender };

for (const [id, part] of Object.entries(EDITOR_PARTS)) host.attachEditor(id, part);
