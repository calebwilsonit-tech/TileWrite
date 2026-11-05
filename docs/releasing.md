# Releases and versions

A **release** is a build of Tilewright that was made on purpose, when the engine was in a stable state: it has a version number (`0.1.0`), a git
tag (`v0.1.0`), an entry in `CHANGELOG.md` and an installer. Everything else is a build between releases.

## Making one

```
npm run release -- patch     # a fix           0.1.0 -> 0.1.1
npm run release -- minor     # something new   0.1.0 -> 0.2.0
npm run release -- major     # a big change
```

It stops unless you are on `main`, up to date with origin, with nothing uncommitted (line-ending-only differences do not count), and the type check
and the tests pass. Then it raises the version in both `package.json` files, writes the changes since the last release into `CHANGELOG.md`, commits
"Release vX.Y.Z", tags it, builds the Windows installer (`packages/editor/release/Tilewright-X.Y.Z-win.exe`, with `RELEASE.json` beside it holding
its checksum) and pushes the commit and the tag. `--no-push`, `--no-installer` and `--skip-tests` exist for when you need them.

## Seeing what is installed

```
npm run installed
```

reads `resources/build-info.json` from the installed Tilewright (Program Files, or `%LOCALAPPDATA%\Programs`) and says its version, its commit and whether it
is a release, whether a newer release exists, and how many engine commits have landed since it was built. The editor shows the same in its top bar
(`v0.1.0`, or `v0.1.0 (a1b2c3d)` for a build between releases; hover for the commit and time).

## What a game says it needs

A project can name the oldest Tilewright it works with: `"engine": "0.1.0"` in `project.json`. Opening it in an older Tilewright shows a warning
instead of letting it play wrongly. Raise it when the game starts to use something the engine added (the port keeps it in `tools/port/porter.ts`).

Changes to the **game** (art, scripts, scenes) never need a new install: they live in the project folder. Only a change to the engine does.
