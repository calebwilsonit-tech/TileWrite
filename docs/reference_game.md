# Reference game: The Last Storytender

Tick an item when the engine can make it **without code**, verified by a test or a sample.

## Isometric world
- [x] 64x32 diamond tiles, multiple height levels per cell
- [x] Stairs/ramps between levels, cliffs
- [x] Pits (fall animation, damage, respawn) - falling and respawn work (M2); fall damage and return to solid ground work with Health (M7)
- [x] Water, bridges
- [x] Wall occlusion fade
- [x] Correct depth sorting of tall objects, characters, props at every height

## Player
- [x] 8-direction movement, walk/run (with drawn, animated, mirrored sprites)
- [x] Dodge
- [x] Melee weapon (quill)
- [ ] Health, light/resource bar - hearts and Health done (M7); no light/resource bar yet
- [ ] Interact button, quick-slot items

## Echoes
- [x] Record movement for up to N seconds, replay as ghost
- [x] Ghost stands on pressure plates
- [x] Several echoes at once; capacity upgradable by story flag
- [x] Ghosts pass through some gates

## Puzzle parts
- [x] Pressure plates (momentary / latched)
- [x] Gates/doors linked to plates or logic
- [x] Pushable crates
- [x] Levers, timers
- [x] Sentence stones (swappable word changes the world)
- [x] Formattable text blocks (underline = bridge, bold = wall, italic = slide)
- [x] Rising dough that grows over time, faster near light

## Light
- [x] Lantern lighting a radius, dark areas
- [x] Lights affecting puzzle objects
- [x] Dynamic 2D lighting with shadows

## Enemies and bosses
- [x] Patrol paths
- [x] Vision cones (stealth) and hearing
- [x] Chase / search / return states
- [x] A* pathfinding on the iso grid with heights
- [x] Boss fights with phases; boss active only in certain rooms

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
