# Known issues

- **Electron binary download is flaky on this machine (2026-10-16).** `node node_modules/electron/install.js` stalled twice on the GitHub release asset. Workaround used: `curl.exe -C -` with retries, verify SHA256 against `node_modules/electron/checksums.json`, unzip into `node_modules/electron/dist`, write `path.txt` containing `electron.exe`. Not a repo bug; document in `docs/BUILDING.md` if the user hits it.
- npm 11 blocks dependency install scripts by default; `esbuild` and `electron-winstaller` are approved in the root `package.json` `allowScripts`.
- CI workflow has never run (no remote repository yet).
- `dist:win` (editor installer) is wired up but untested; tracked under M12.
