# Nightgarden

A puzzle game about a night gardener, made with Tilewright. Lamps make light; moonblooms rise where it is lit and sink
where it is dark. A risen bloom is a wall, a lift and a shadow. Light the lamps, push what can be pushed, find the way out.

Open `games/nightgarden/project` in the editor (**Open an existing project**) and press Play, or export it.

**Read [DESIGN.md](DESIGN.md) before drawing a picture or changing a screen.** It is the one place the look, the
colours, the type sizes, the screens and their flow are decided.

## How it is made

| Folder | What is in it |
| --- | --- |
| `project/` | The game: an ordinary Tilewright project. **Built, never edited by hand** (the check fails if it differs from a fresh build). |
| `src/rooms/` | Every room as a small text grid (the legend is at the top of `src/model.ts`). |
| `src/scripts/` | The game's behaviours, as Tilewright scripts: the gardener, lamps, blooms, gates, moonstones, the way out, fireflies, the room itself. |
| `src/light.ts` | The light rule. The solver uses it directly and the build writes the same text into the Room script. |
| `src/ui/` | The screens (`screens.ts`) and the pieces they are made of (`kit.ts`). |
| `src/solver.ts`, `src/replay.ts`, `src/verify.ts` | The rules as a state machine, a bot that plays a plan with a player's buttons, and the two together. |
| `art/` | Every picture as a list of strokes (`pictures.ts`, `tiles.ts`); `studio.spec.ts` draws them in the editor's Sprite studio and Tile studio with the mouse; `out/` is what the editor saved. |
| `check/` | The checks. `check/rooms.md` is the room list the last run wrote. |
| `e2e/` | The real editor opens the game, checks it, plays it and takes a picture of every screen (`screenshots/`). |
| `lab/` | Helpers for designing rooms (a quick solve of every room, a search for drafts). |

It uses two plugins: **Lighting** (to draw the dark and the glow) and **Room camera** (`packages/plugins/room-camera`,
written for this game because the engine had no way to hold the camera still on a room).

## Commands (from the repository root)

```bash
npm run nightgarden:build     # write project/ from the sources
npm run nightgarden:check     # the checks: run before every commit
xvfb-run --auto-servernum -s "-screen 0 1600x1000x24" npm run nightgarden:e2e   # the editor run (Linux; plain `npm run nightgarden:e2e` elsewhere)
npm run nightgarden:art       # draw new or changed pictures in the studio (NG_ONLY=lamp,tiles for some, NG_FORCE=1 for all)
```

The end-to-end run and the art need the editor built once: `npm run build`.

## What the checks hold

1. `project/` is exactly what the sources build.
2. The project opens with no problems and passes the editor's whole-project check; every picture is there, the size and
   feet point the art list says, in the inks of the design.
3. Every room is solved by the rules (the shortest way out, and the shortest way that also catches the firefly) and both
   are played in the real game, button by button, with the game compared to the rules after every step.
4. Every screen keeps to the theme: its colours, the five type sizes, spacing in fours; every button leads somewhere and
   every menu can be left.
5. The flow of the game is walked with a player's buttons: title, settings, new game, chapter card, pause, rooms,
   restart, finishing a room, going back to one, the end.
