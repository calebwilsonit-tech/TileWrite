import { defineBehavior } from '../framework';

export interface WorldUi {
  /** The UI prefab (made in the UI designer) that floats over this object. */
  prefab: string;
  /** How far above the object's feet it hangs, in cells. */
  height: number;
  /** Shown only while this holds ("{self.hp} < {self.maxhp}"). */
  showWhen: string;
  /** Hidden when the player is farther than this many cells (0 = always shown). */
  maxDistance: number;
}

export const worldUi = defineBehavior<WorldUi>({
  id: 'worldUi',
  name: 'World UI',
  category: 'Interface',
  description: 'Hangs a piece of interface over this object: a health bar above a unit, a speech bubble, a price tag, a "press E" prompt. The piece is a UI prefab from the UI designer; inside it, {self.hp}, {self.name} and {self.health.max} (any setting of any part) mean this object.',
  phase: 'actuator',
  dataOnly: true,
  defaults: { prefab: '', height: 1.6, showWhen: '', maxDistance: 0 },
  fields: [
    { key: 'prefab', label: 'UI prefab', type: 'text' },
    { key: 'height', label: 'Height above the object (cells)', type: 'number', min: 0, max: 10, step: 0.1 },
    { key: 'showWhen', label: 'Shown only when', type: 'text' },
    { key: 'maxDistance', label: 'Hide when the player is farther than (cells, 0 = never)', type: 'number', min: 0, max: 60, step: 1 },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  update() {
    // drawn by the interface screens (see screens-dom.ts)
  },
});
