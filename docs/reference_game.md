# Reference game: The Last Storytender

Tick an item when the engine can make it **without code**, verified by a test or a sample.

## Isometric world
- [x] 64x32 diamond tiles, multiple height levels per cell
- [x] Stairs/ramps between levels, cliffs
- [ ] Pits (fall animation, damage, respawn) - falling and respawn work (M2); damage needs Health (M7)
- [x] Water, bridges
- [x] Wall occlusion fade
- [x] Correct depth sorting of tall objects, characters, props at every height

## Player
- [ ] 8-direction movement, walk/run
- [ ] Dodge
- [ ] Melee weapon (quill)
- [ ] Health, light/resource bar
- [ ] Interact button, quick-slot items

## Echoes
- [ ] Record movement for up to N seconds, replay as ghost
- [ ] Ghost stands on pressure plates
- [ ] Several echoes at once; capacity upgradable by story flag
- [ ] Ghosts pass through some gates

## Puzzle parts
- [ ] Pressure plates (momentary / latched)
- [ ] Gates/doors linked to plates or logic
- [ ] Pushable crates
- [ ] Levers, timers
- [ ] Sentence stones (swappable word changes the world)
- [ ] Formattable text blocks (underline = bridge, bold = wall, italic = slide)
- [ ] Rising dough that grows over time, faster near light

## Light
- [ ] Lantern lighting a radius, dark areas
- [ ] Lights affecting puzzle objects
- [ ] Dynamic 2D lighting with shadows

## Enemies and bosses
- [ ] Patrol paths
- [ ] Vision cones (stealth) and hearing
- [ ] Chase / search / return states
- [ ] A* pathfinding on the iso grid with heights
- [ ] Boss fights with phases; boss active only in certain rooms

## Story
- [ ] NPC dialogue with choices, conditions, flags
- [ ] Cutscenes on a timeline (camera, characters, dialogue, fades)
- [ ] Hub overworld with several dungeons
- [ ] World map with fast travel

## Checkpoints
- [ ] Lantern posts you light or rest at
- [ ] Death sends you to the most recent post
- [ ] Dungeon pause menu with Restart and Travel-to-lit-lantern

## Systems
- [ ] Inventory, items, quick slots
- [ ] Save/load with multiple slots and autosave
- [ ] Story flags and counters
- [ ] Settings menu (audio, video, controls)
- [ ] Full input remapping, gamepad support
- [ ] Pause menu, HUD
- [ ] Minigames inside the game
- [ ] Cosmetic skins, difficulty options

## Feel
- [ ] Screen shake, hit-stop
- [ ] Particles, tweens
- [ ] Sound effects with variation
- [ ] Music with crossfades
- [ ] Camera follow with deadzone and room bounds
