# Reference game: The Last Storytender

Tick an item when the engine can make it **without code**, verified by a test or a sample. The acceptance slice (docs/acceptance.md) builds hub, dungeon, echo/crate/word puzzles, stealth, boss, lanterns, saves and remapping together.

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
- [x] Interact button, quick-slot items

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
- [x] NPC dialogue with choices, conditions, flags
- [x] Cutscenes on a timeline (camera, characters, dialogue, fades)
- [x] Hub overworld with several dungeons
- [x] World map with fast travel

## Checkpoints
- [x] Lantern posts you light or rest at
- [x] Death sends you to the most recent post
- [x] Dungeon pause menu with Restart and Travel-to-lit-lantern

## Systems
- [x] Inventory, items, quick slots
- [x] Save/load with multiple slots and autosave
- [x] Story flags and counters
- [ ] Settings menu (audio, video, controls) - volumes, difficulty, screen shake and hit freeze and controls done; video options not done
- [x] Full input remapping, gamepad support
- [x] Pause menu, HUD
- [ ] Minigames inside the game
- [ ] Cosmetic skins, difficulty options - difficulty done (M8); skins not done

## Feel
- [x] Screen shake, hit-stop (M14; the game window holds the simulation for a few frames, settings switch it off)
- [x] Particles (seven presets, event action and automatic on hits); tweens drive gates and doors
- [x] Sound effects with a little pitch variation (M14; checked against a pretend sound card and by loading real files in the editor; not judged by ear)
- [x] Music with crossfades (M14; region music and the Change the music action)
- [x] Camera follow with deadzone and room bounds
