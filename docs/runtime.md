# Runtime core (M1)

Package: `packages/runtime`. Everything under `src/` except `render/iso-renderer.ts`, `runner.ts` and `input/keyboard.ts` is pure TypeScript with no DOM, so it runs in tests and in headless playbots.

## Conventions
- Grid coordinates `(x, y)` are in tiles. Height `h` is in levels (`heightPx` screen pixels each, default 16).
- Projection: `screenX = (x - y) * tileW/2`, `screenY = (x + y) * tileH/2 - h * heightPx`. Default tile is 64x32.
- Screen "down" is grid `(+1,+1)`; screen "right" is `(+1,-1)`. Use `screenIntentToGrid` to turn WASD-style input into grid movement.
- Facing index 0..7 runs clockwise from East on screen: E, SE, S, SW, W, NW, N, NE.

## Modules
| Module | What it does |
| --- | --- |
| `iso/math` | grid <-> screen conversion, cell queries, neighbours, facing, supercover line-of-sight |
| `core/timestep` | `FixedTimestep`: real time -> whole 60 Hz steps, capped catch-up |
| `core/rng` | seeded `Rng` (mulberry32) |
| `core/simulation` | `Simulation`: world + input + rng + ordered systems; `step(snapshot)`; `stateHash()` for determinism checks |
| `scene/world` | `World`, `Entity`, `EntityRef`: components, tags, queries, deferred spawn/destroy, ids never reused |
| `input/input` | `InputMap` (bindings -> actions), `InputState` (edges, axes), `InputRecorder` / `InputPlayback` |
| `input/keyboard` | `DomInputSource` (keyboard + mouse), `DEFAULT_INPUT_MAP` |
| `tilemap/tilemap` | `TileMap` (tile id + height per cell), default procedural tileset |
| `render/camera` | `Camera`: follow, deadzone, smoothing, bounds, zoom, seeded shake |
| `render/depth` | `sortBoxes`: back-to-front order for tall and multi-cell objects |
| `render/iso-renderer` | PixiJS renderer (procedural art until the sprite studio) |
| `runner` | `GameRunner`: rAF loop, fixed steps, pause/step, input recording |

## Rules for systems (so replays stay exact)
1. Read time only from `ctx.dt` and `ctx.tick`; randomness only from `ctx.rng`.
2. Spawn/destroy freely: spawns appear after the tick, destroyed entities are skipped at once. Keep a `world.ref(id)` instead of an entity when you hold it across ticks.
3. Never touch the renderer or camera from a system.

## Depth sorting
Each drawable is a box `(minX..maxX, minY..maxY, minZ..maxZ)`. For two boxes that overlap on screen: separation in the ground plane decides who is in front; if footprints overlap, the higher one is in front. Ordering is a topological sort with a stable tie-break key, so output never depends on input order. Interpenetrating geometry (a cycle) is broken by key order instead of crashing.

## Sample
`samples/m1-walking-square` runs inside the editor: start the editor, click "Open the M1 sample". Tested by `e2e/m1-walking-square.spec.ts`.
