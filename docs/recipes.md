# Recipes

Short, step-by-step ways to make common things. Names in **bold** are buttons, panels or tools; names in `code` are behaviour or setting ids (see [behaviours.md](behaviours.md) and [event-blocks.md](event-blocks.md)). Every recipe works with the mouse and keyboard only. If you have not yet made anything, do the tutorial first (the project screen's **Take the tutorial** button).

## A door that a lever opens
1. **Place** tool: put a **Lever** and a **Gate**.
2. **Wire** tool: press on the lever, drag to the gate, let go. Keep the defaults (the lever's *Pulled* signal to the gate's *Open*).
3. In **Play** walk up to the lever and press E: the gate slides open. To make it close again when the lever is pulled back, leave the lever as it is (it toggles).
4. Want it to stay open forever? Select the lever and turn on its latch, or use a **Logic gate** with *Latch*.

## A plate held down by a crate
1. Place a **Pressure plate**, a **Crate** and a **Gate**; wire the plate to the gate.
2. The player walks into the crate to push it one cell at a time onto the plate.
3. Make it fair: build the crate's path as a corridor with walls on both sides so it cannot be pushed into a corner. Press **Check puzzles** in the Problems panel: it reports a crate that can get stuck, and says which push does it.
4. Give the player a way out of a stuck room (a second crate, a reset lever) if the check warns.

## An echo puzzle (two plates, one player)
1. Select the **Player** and add the **Echo Recorder** behaviour (*capacity* 2 lets two echoes exist at once).
2. Place two **Pressure plates**. Set one to be pressed by *Echoes* (only a recorded copy of you can hold it) and the other by *The player*, with *Stays down once pressed* on.
3. Place a **Logic gate** (it ANDs its inputs), a **Gate**, and wire: plate 1 to the logic gate's `a`, plate 2 to `b`, logic gate to the gate.
4. In play press R to start recording, walk to the first plate, press R again to stop: your echo walks the same path and stands on the plate. Now walk to the second plate yourself.

## A sentence that builds a bridge
1. Paint a **Pit** two or more cells wide.
2. Place a **Text block** over the pit (it is two cells wide) and, if needed, nudge its **X** in the Inspector so it covers the pit.
3. Place a **Sentence stone** (its sentence reads "The bridge [ BREAKS | HOLDS ]").
4. Wire the stone's `word2` output to the text block's **Underline** input. Walking up to the stone and pressing E swaps the word; "HOLDS" underlines the text, which becomes a flat bridge.

## A guard who patrols and notices you
1. **Place** a **Guard** (it already has *Health*, *Vision Cone*, *Chase* and *Patrol* and hurts on touch).
2. Pick the **Patrol path** tool, click the guard, then click the cells it should walk between (Shift-click removes the last point; do not click the guard's own cell).
3. Turn on **Layers -> AI** (view overlays) to see its route and its vision cone. It sees you in the cone, hears running, chases around walls, searches, and goes home.
4. Give the player a *Melee Attack* so there is an answer; or leave the guard as something to sneak past.

## A guard that gets angry and calms down
1. Place a **Guard**, select it and add **State Machine** (Inspector).
2. **Start from an example -> Guard**. Click the *Chase* card and change its **Speed**, or add a **Message** like "Hey! You there!".
3. Drag from the dot on *Look around* to *Patrol* and set the arrow to "it has been here 8 s" so it settles down sooner. Play to see it change mood; the Problems panel warns if a state can never be reached. See [ai-and-combat.md](../packages/plugins/combat/docs/ai-and-combat.md).

## A boss in two phases
1. Draw a **Region** over the arena and turn on *Bosses here only act while the player is inside*.
2. Place a **Boss** inside it and set its *Health* (for example 8) and *Invulnerable seconds* (0.4).
3. Its *Boss Phases* behaviour speeds it up and strengthens it as its health falls (at 60% and 25% by default). Wire its **Defeated** output to the **Exit** gate.

## A conversation with a choice that changes the world
1. **Story panel -> Dialogues**: make one called "Elder". Add a line, then a **Choice** with two options; add a **Set a variable** step (variable `accepted`, value 1) after the option you want to reward and join the options to the right steps.
2. Place an **NPC**, choose the "Elder" dialogue in its Inspector.
3. **Events panel**: add a row "When `accepted` is at least 1 -> switch the seal's collision off, hide it". Now agreeing opens the way. (Event sheets know which flags conversations set.)

## Checkpoints and what happens on defeat
1. Select the **Player** and add *Health* with *When defeated* set to *Respawn*.
2. Place a **Lantern post**. The player lights it with E; defeat returns them to the last post they lit. The pause menu's **Restart** and **Travel to a lit lantern** use the same posts.

## A dark room lit by lanterns
1. Draw a **Region** over the room and slide *Darkness* up (0.8 is dark).
2. Place **Lanterns** (they cast light and shadows from walls) and give the player the *Light* behaviour.
3. A **Light sensor** sends a signal while its spot is lit: wire it to a gate for a "light the room to open the door" puzzle. A **Rising dough** grows faster near light.

## A way to another scene
1. **+ Scene** adds a scene; build it and give it a **Marker** named, say, "Cave entrance".
2. In the first scene place a **Scene portal**; set its scene (`scenes/cave.scene.json`) and *Appear at* "Cave entrance". Add a portal back the other way. Items, flags, lit lanterns and health come along.

## Music for a room
1. **Assets -> Add a sound file...** and pick a music file (OGG keeps it small).
2. Draw a **Region** over the room; in the Inspector type the file's name in **Music** (the box suggests your files).
3. Play: walking in fades the music in. A second room with different music crossfades when you cross over. More in [sound-and-effects.md](sound-and-effects.md).

## A door that slams open with a bang
1. Wire a lever to a gate as in the first recipe.
2. **Events panel**: *When the lever is pulled*, do **Shake the screen** (4 pixels), **Burst of sparks, dust or glow** (kind: dust, at the gate) and **Play a sound** ("thud").
3. For a weapon that feels heavier, raise the Melee Attack's **Freeze on a hit** and **Screen shake on a hit**.

## A lake with a shore
1. **Tiles -> Autotiling...**, pick *water*, press **Make edges and corners** (choose a white or sand edge colour first), then **Save and apply to this scene**.
2. Paint water with the Water tool or a tile brush: the outline appears on the sides that border grass, and inner corners get dots. One Undo removes the whole stroke.
3. For raised ground with rocky sides, do the same for *stone* with **Make cliff faces**. See [autotiling-and-layers.md](autotiling-and-layers.md).

## See the floor behind a tall wall
**Layers -> Walls**: untick it to hide every wall tile (brick), tick **Lock** to keep tools from painting over them. Flowers, rugs and bushes from the Place tool's Decoration group have their own layer, so you can hide them while you work on puzzles.

## A game in two languages
1. **Story -> Translations...**, add a language (code `fr`, name `Français`).
2. Type a translation beside each line, **Save**. Untranslated lines show the original.
3. In Play or an exported game, **Pause -> Settings -> Language** switches it. See [translations-and-settings.md](translations-and-settings.md).

## Reuse an object (prefabs)
1. Select an object and press **Make a prefab from this object...**, give it a name.
2. Place it from the **Place** tool's "Your prefabs" group. Change the prefab and every copy follows, except for settings you changed on a copy.

## Check a level before you share it
1. **Problems -> Check puzzles**: bypassable gates, unreachable goals, useless gates and crate puzzles that can get stuck.
2. **Check the whole project**: every scene, door, conversation and cutscene.
3. **Playbot**: **Play to the goal** lets the bot try the level with only the buttons a player has. Save its run as a playthrough to replay after later changes.
4. Press **Export...** (see [export.md](export.md)); it runs the project check first and refuses if something is broken.

## Ask Claude for help
Open the **Claude** tab, add your key once, and either press **Explain** / **Fix with Claude** next to a problem or describe what you want ("a room where two echoes must hold two plates at once"). Every change appears as a card you approve; each approved change is one undo step. See [assistant.md](assistant.md).
