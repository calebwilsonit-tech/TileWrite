# Echoes, light and word puzzles (M6)

All of this is added from the Inspector's **Behaviours -> Add** menu or the Place tool (groups "Story puzzles" and "Light"). Code: `packages/behaviors/src/builtins/{echo,light,text}.ts`, `packages/runtime/src/lighting`, `packages/runtime/src/render/lighting-layer.ts`.

## Echoes
Add **Echo Recorder** to the player. In play, **R** starts recording your movement (a red "recording" label shows), **R** again (or the time limit) finishes it and a see-through ghost repeats exactly what you did. Settings: longest recording, how many echoes at once, an optional variable that adds to that number (set it from an event row when the player finds a story item), what an echo does when it finishes (stay where it ended, loop, or vanish), and how see-through ghosts are.

- Starting a new recording, and finishing one, sends **every** echo back to its start so they all play together. At capacity the oldest echo is replaced.
- Echoes are bodies on the Echo collision layer. A Pressure Plate set to "Pressed by Echoes" counts only ghosts; "Anything" counts them too. A Gate with **Echoes can pass through** lets ghosts walk through while it blocks you.
- Echoes replay recorded input through the same movement code as the player, so they are deterministic. They can push crates and trigger zones like anyone else.
- Problems panel: warns when capacity is 0 and no variable can raise it.

## Light and darkness
- **Regions** have a Darkness slider. The `darkness` variable darkens the whole scene (set it from an event row to switch the lights out).
- **Light** (the Lantern in the Place tool) lights a radius; walls (blocked cells, walls much taller than the light) and tall solid objects such as pillars and closed gates cast shadows. Colour, brightness, flicker, and whether it shines always / while a wire is on / while a wire is off. Put it on the player for a lantern.
- **Light Sensor** sends a signal while its spot is lit (or dark): wire it to a gate. **Rising dough** (Growing Object) rises over time, much faster in light, and becomes a taller solid block, so it can turn into a platform or wall; a Shrink signal deflates it.
- `lightLevel` / `isLit` in `@tilewright/runtime` answer "is this spot lit?" for any behaviour. The lighting model is rebuilt every tick (`runtime.lighting`) and drawn by the renderer: darkness goes into an off-screen texture and each light erases a soft, shadow-shaped hole.

### Lantern fuel: the light as a resource
Add **Light Resource (lantern fuel)** to the player (Inspector -> Add a behaviour; it brings the **Light** it shrinks). The lantern then **burns down** (*Burns down per second*), its glow **shrinks** as it empties (down to *Its glow reaches this far when empty*), it **flickers** and signals *Low* below a percentage, and the game shows a **light bar** under the hearts. It **refills** while the player stands in the glow of *another* light (a lantern post, a torch: the player's own light never refills itself), when **resting at a lantern post** and when the player is defeated (each can be switched off). When empty it can **hurt in the dark** (*Damage every two seconds in the dark when empty*; 0 = harmless). The amount is the variable `light` (out of `lightMax`), so event rows, items and conversations can read and change it; the action **Add to (or take from) the lantern's light** adds or removes some (0 fills it up). Wires: *Is running low*, *Is empty*. Tested by `packages/behaviors/src/lantern.test.ts` and `e2e/m15-lantern.spec.ts`.

## Puzzles from event rows
Event rows can read and change the puzzle parts too (category **Puzzles**): the conditions **Echoes exist** (at least N), **A spot is lit (or dark)**, **A sentence stone shows a word** and **A text block is formatted a certain way**, and the actions **Change the word of a sentence stone**, **Format a text block** and **Make every echo vanish**. A row like "when a stone shows HOLDS and the lamp spot is lit, open the gate" needs no wires.

## Word puzzles
- **Sentence Stone**: a stone with a sentence and a swappable word, like "The bridge [ HOLDS ]". Press **E** beside it to swap. Each of the first four words has its own signal (Word 1..4 is chosen): wire a word to what it should do, for example "HOLDS" to a gate. The chosen word can also be stored in a variable for event rows. Needs at least two words.
- **Formattable Text Block**: plain text does nothing; **underlined** it becomes a flat solid bridge (put it over a pit, two cells wide by one deep); **bold** a wall; **italic** it becomes slippery and slides until it hits something when pushed. The player cycles the formatting with **E**; wires into Underline / Bold / Italic override it.
- Both show their text above them (any object can: the `label` component).

## Tested by
Unit: `packages/runtime/src/lighting/lighting.test.ts`, `packages/behaviors/src/m6.test.ts` (echo recording/replay/determinism/capacity/gates, light, sensors, dough, stones, text blocks, a bridge over a pit), editor validators in `packages/editor/src/renderer/model/logic.test.ts`. End to end: `e2e/m6-echoes.spec.ts` (two-echo room in the dark, built and solved through the UI) and `e2e/m6-words.spec.ts` (stone opens a gate, underlined text bridges a pit).
