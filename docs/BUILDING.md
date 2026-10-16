# Building Tilewright on Windows

This explains how to compile the **editor itself** into a Windows program on your own PC. (To turn a *game* you made into a program, see [export.md](export.md).)

## What you need

1. **Windows 10 or 11** (64-bit).
2. **Node.js LTS** from <https://nodejs.org> (choose the "LTS" button; the default options are fine). Check it worked by opening PowerShell and typing `node --version` (it should say v20 or higher).
3. **Git** from <https://git-scm.com> to get the code (or download the project as a zip and unzip it).
4. About **3 GB of free disk space** and an internet connection for the first build (it downloads the Electron runtime and the installer tools).

## Steps

Open PowerShell in the folder that holds the Tilewright code, then:

```powershell
npm ci
npm run dist:win
```

* `npm ci` installs exactly the versions in `package-lock.json` (a few minutes the first time).
* `npm run dist:win` builds the editor, the game player used by Export, and then packages everything with electron-builder.

When it finishes, look in **`packages\editor\release\`**:

| File | What it is |
| --- | --- |
| `Tilewright-<version>-win.exe` | The installer. Double-click to install Tilewright. |
| `Tilewright-<version>-win.zip` | The same program as a zip, no installer needed: unzip and run `Tilewright.exe`. |
| `win-unpacked\` | The unpacked program folder (what the zip contains). |

If Windows SmartScreen says "unknown publisher", that is because the program is not code-signed; choose *More info* then *Run anyway* on your own build.

## Running it without building an installer

```powershell
npm ci
npm run build
npm run start -w @tilewright/editor
```

For development with live reload, use `npm run dev`.

## Checking your build

```powershell
npm run typecheck
npm run lint
npm test            # unit tests
npm run test:e2e    # builds the editor, then drives the real app with Playwright (several minutes)
```

`npm run test:e2e` includes a test that exports a game from the editor and runs the exported `.exe`, so a green run means the whole path from project to a running game works on your PC. The tests clean up the temporary folders they make; each export test run briefly uses about 1 GB of disk.

## If something goes wrong

* **`npm ci` fails with a network error**: run it again; the first run downloads a lot.
* **The Electron download stalls** (it can on slow connections): run `node node_modules/electron/install.js` again, or download the Electron zip for your version from the Electron releases page and unzip it into `node_modules\electron\dist`, writing `electron.exe` into `node_modules\electron\path.txt`.
* **electron-builder cannot download its tools** (the installer step needs the NSIS and signing helpers from GitHub): retry on a better connection, or build only the zip without the helpers and without a download of Electron itself:

  ```powershell
  npm run build
  cd packages\editor
  npx electron-builder --win zip --publish never --config.electronDist=../../node_modules/electron/dist --config.win.signAndEditExecutable=false
  ```

  (The zip's `Tilewright.exe` then keeps the generic Electron file icon and version information.)
* **"no space left on device"**: the build and the end-to-end tests make large temporary files; free some disk space and run `npm run test:e2e` again (it removes its own leftovers).
* **PowerShell refuses to run scripts**: run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `cmd.exe` instead.

## Continuous integration

`.github/workflows/ci.yml` runs the checks on Windows and Linux for every push, and a `windows-build` job runs the same `npm run dist:win` and keeps the installer as a downloadable artifact.
