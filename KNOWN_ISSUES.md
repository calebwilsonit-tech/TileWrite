# Known issues

- **Electron binary download is flaky on this machine (2026-10-16).** `node node_modules/electron/install.js` stalled twice on the GitHub release asset. Workaround used: `curl.exe -C -` with retries, verify SHA256 against `node_modules/electron/checksums.json`, unzip into `node_modules/electron/dist`, write `path.txt` containing `electron.exe`. Not a repo bug; document in `docs/BUILDING.md` if the user hits it.
- npm 11 blocks dependency install scripts by default; `esbuild` and `electron-winstaller` are approved in the root `package.json` `allowScripts`.
- CI workflow has never run (no remote repository yet).
- `dist:win` (editor installer) is wired up but untested; tracked under M12.
- `npm audit` reports a moderate issue (sprintf-js DoS, via `electron-builder` -> `app-builder-lib` -> `@electron/get` -> `global-agent` -> `roarr`). It is in the build tooling only and is not shipped in the editor or exported games. Revisit when `electron-builder` updates (M12).
- M3 deferred (listed in PROGRESS.md): hot reload during play, separate game window, Decoration/Walls/Lights layers, autotiling rules, per-height collision painting, bypass/soft-lock validators (M9), asset import (M4).
- The "Explain" button in the Problems panel is disabled until the Claude assistant exists (M11).
- Dock panels can be closed with their X; use Commands -> Reset panel layout to bring them back.

- M5 deferred: prefab children are not shown/edited individually in the editor; wires only combine with OR (use a Logic Gate for anything else); no visual state machine editor for enemy/boss behaviour (M7); echo/light/sentence-stone parts are M6; Health/Damage/Patrol/Chase/Vision/Boss are M7; inventory/NPC/Checkpoint/Portal are M8.
- Wire-tool and event-sheet UI are covered by one e2e plus unit tests, not by exhaustive interaction tests.
- M6 deferred: lights do not tint tiles (only a faint additive glow); region darkness has hard edges at the region border; shadows ignore decks/slopes; no edit-mode lighting preview (only in Play); sentence stones expose only the first four words as wire signals; no lantern fuel or light resource bar (M7/M8); echo/light/word objects have only procedural (box) art.