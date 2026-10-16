# Decisions

Append only. Each entry: choice, rejected options, reason.

## D001 - Stack (2026-10-16)
Electron + TypeScript + React for the editor, PixiJS for rendering (from M1), Vitest, Playwright, Zod.
Rejected: Tauri (Rust toolchain needed on user's PC, weaker Playwright story), Godot/Unity (not a deliverable we can ship as our own engine).
Reason: one language, `electron-builder` makes a Windows `.exe`, Playwright can drive the Electron window.

## D002 - Build tooling for the editor (2026-10-16)
Renderer built by Vite. Main and preload bundled by esbuild (main as ESM `main.mjs`, preload as CJS `preload.cjs` because sandboxed preloads must be CJS).
Rejected: `electron-vite` / `electron-forge` (extra layer to learn and debug; esbuild + Vite are already dependencies).

## D003 - Packages are consumed from source (2026-10-16)
Workspace packages set `main`/`types` to `./src/index.ts`; Vite, Vitest and esbuild bundle them directly. One root `tsconfig.json` with `noEmit` type-checks everything.
Rejected: TS project references with `composite` (slow iteration, d.ts build step with no benefit while everything is bundled anyway).
Revisit if the runtime is ever published standalone.

## D004 - Node and git installed via winget (2026-10-16)
The dev machine had neither. Installed Node.js LTS (24.x) and Git for Windows with winget, with the user's approval.
Note: PowerShell sessions started before the install need a PATH refresh.

## D005 - Project file format (2026-10-16)
Plain JSON with `schemaVersion` and migrations, validated by Zod; PNG for images, OGG/WAV for audio. (Implemented from M1.)
