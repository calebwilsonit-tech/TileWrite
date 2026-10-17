# Sound, music and effects

Games feel better with sound, a little shake when something hits, and a puff of dust. Everything here works from the editor without code.

## Adding sounds and music
1. Open the **Assets** panel and look for **Sounds and music**.
2. Press **Add a sound file...** and pick a WAV, OGG, MP3, FLAC or M4A file (up to 25 MB; OGG is the smallest). The file is copied into your project's `assets/audio` folder, so it travels with the project and ships with an exported game.
3. The file's name, without its ending, is the sound's name: `chime.wav` is "chime". Press the play button next to a sound to hear it; the cross removes it.

Music is just a long sound that loops; whether something is "sound" or "music" depends on how you ask for it.

## Making things play
| You want | Do this |
| --- | --- |
| A sound at some moment | **Events panel**: add the action **Play a sound** and type or pick the name. Volume is 0 to 1. |
| Music that changes | The action **Change the music**. Leave the name empty to fade it out. The old track fades out as the new one fades in. |
| Music for a room | Draw a **Region**, then in the Inspector set **Music** to a sound name. It starts (fading in) when the player walks into the room and stays on when they leave, until another room or action asks for something else. |
| Sounds in a cutscene | The cutscene steps **Play a sound** and **Change the music** (Story panel). |
| Fighting sounds | Name sounds **hit** (an enemy is hurt), **hurt** (the player is hurt) and **defeat** (something is beaten) and they play by themselves. No file with that name means silence, not an error. |

The Problems panel warns when an action, cutscene or region uses a name that is not in **Assets -> Sounds**, and the project check does the same before you export.

Each time a sound plays it drifts a few percent in pitch so repeated hits do not sound mechanical. The same sound cannot start twice within a twentieth of a second, and at most 24 sounds play at once.

The player's **Settings** menu has Master, Music and Sound effects volumes; they apply at once and are remembered.

## Hit feel: freeze, shake and sparks
- **Hit freeze** ("hit-stop"): the world holds still for a few frames when a heavy hit lands. The player's buttons are not lost; the game just waits a moment.
- **Screen shake**: a short knock that fades by itself.
- **Sparks, dust and glow**: little bursts of coloured specks (hit sparks, sparks, dust, smoke puff, healing glow, magic, confetti).

The player being hurt always gets a short freeze, a knock and orange sparks; an enemy being hurt gets sparks, and the **Melee Attack** behaviour has two settings, **Freeze on a hit** (seconds) and **Screen shake on a hit** (pixels), for how the swing feels (defaults 0.05 s and 2 px; set both to 0 for a gentle weapon). Defeats puff smoke.

You can also ask for any of these from the **Events panel**: **Burst of sparks, dust or glow** (choose where, which kind, how many), **Shake the screen** and **Freeze the game for a moment**. A good "door slams open" row is: shake 4 pixels, dust at the door, play the sound "thud".

### Turning it down
The game's **Settings -> Screen shake and hit freeze** switch turns off both the shake and the freeze. The editor's **Accessibility -> Reduce motion** also turns off sparks, shake and freeze. Neither changes how the game plays: these effects are only pictures and sounds, and they never affect the game's saved state, the playbot or the checks.

## How it works (for the curious)
- The simulation only *asks* for effects (`runtime.fx`, `runtime.hitStop`, `view.impact`); the game window shows them. A run with no window (the playbot, the checks, the tests) ignores them and plays out exactly the same.
- Hit-stop is done by the game window not stepping the simulation for a few frames. That is why a recorded playthrough replays identically with or without it.
- Sound uses the browser's Web Audio inside the Electron window; the engine part is `packages/runtime/src/audio/engine.ts`, tested against a pretend sound card.
