# Terrain, heights and collision (M2)

Code: `packages/runtime/src/tilemap`, `packages/runtime/src/physics`. Sample: `samples/m2-multilevel-room` (open "M2 sample" in the editor).

## Terrain data (`TileMap`)
Each cell holds:
| Field | Meaning |
| --- | --- |
| `tiles` | tile id (0 = void: nothing there, impassable) |
| `heights` | ground height in levels (for a slope: the LOW end) |
| `slopes` | stairs or ramp that rises exactly 1 level toward N / E / S / W |
| `flags` | `PIT` (no floor), `BLOCK` (an invisible wall: solid at every height, or only between `blockLow` and `blockHigh` when those are set), `WATER` (blocks walking), `TRIGGER` (marker) |
| `blockLow`, `blockHigh` | with `BLOCK`: the levels [low, high) the invisible wall covers (high 0 = every height). A body is stopped only when its feet and body overlap those levels, so a walker on a bridge above a low wall passes over it. Scene files only carry these two layers when some cell uses them. |
| `decks` | one walkable layer above the ground, 1 level thick - bridges. You can walk under it if you fit. |
| `oneWay` | cell edges that cannot be entered (they can still be left) |

N = grid -y, E = grid +x, S = grid +y, W = grid -x.

## How a body moves (`physicsSystem`)
Behaviours set `body.vx / vy` (cells per second) each tick; `physicsSystem` moves the body.

- **Blocking** looks at the four footprint corners. A surface more than `stepUp` (0.35 levels) above the feet blocks: that is how cliffs and walls work. A wall lower than your feet does nothing, so a body at height 2 ignores height-0 walls.
- **Support** looks at the footprint centre. The body rides slopes and stairs smoothly, and follows drops up to `stepDown` (0.4).
- **Ledges**: with `ledge: 'fall'` (player) a bigger drop makes the body airborne; it lands with a `landed` event carrying the fall distance. With `ledge: 'block'` (AI) big drops are walls.
- **Pits**: with `pits: 'fall'` the body falls to height -3, the `fell` event fires once, and the body freezes in state `pit`. A rule (see `game-rules` in the sample) respawns it with `teleportBody`. With `pits: 'block'` pits are walls.
- **Water** blocks walking unless `wade: true`.
- **Decks**: the body's feet height picks the layer (deck vs the ground beneath). Falling from above lands on the deck; a body too tall to fit underneath is blocked.
- **Stuck bodies**: a corner already inside something may move away from it, so landings, teleports and spawns can never trap a body inside a wall.
- **Colliders**: a `Collider` component adds a solid box or a trigger area, with `layer` / `mask` bits (`LAYER.PLAYER`, `LAYER.GHOST`, ...). Bodies record `blockedBy` (ids) so pushables can react.
- **Triggers** emit `trigger-enter`, `trigger-stay`, `trigger-exit` with `{ trigger, other }`; they are height-aware, and a destroyed occupant produces an exit.

Constants: gravity 36 levels/s^2, sub-steps of at most 0.2 cells (no tunnelling at any speed, tested up to 400 cells/s).

## Events
`sim.events` (`EventBus`): `on(type, fn)` for immediate handlers, `of(type)` for this tick's log (cleared when the next tick begins). Built-in: `landed`, `fell`, `trigger-*`.

## Rendering
`IsoRenderer.setTileMap` draws columns, ramps, stairs (4 steps), pits (a dark hole with far walls) and decks (slabs). Depth order uses real heights, so a pit hides a falling body and a bridge covers anyone walking under it.

**Occlusion fade**: set `renderer.focus` to the entity to protect. Tiles that rise more than half a level above its feet, are drawn after it and overlap it on screen fade to `fadeAlpha` (0.3) and back. It is cosmetic only (not simulation state).

## Walk test
`reachableCells(map, start)` returns the cells a walker can reach with the same step rules (used by the editor's walk-test mode and the level validators later).

## Not yet
Entities as platforms (standing on crates, moving platforms): bodies are blocked by solid colliders but cannot stand on them. Planned with the Moving Platform behaviour (M5). Collision painting per height and automatic collision from tiles are in the editor (Blocker tool with levels; Layers -> Seen by a walker at).
