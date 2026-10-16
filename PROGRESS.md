# Tilewright progress

Boxes are ticked only when the milestone's tests pass and the sample has been played.
Spec: `ENGINE_BUILD_PROMPT.md`. Read `DECISIONS.md` and `KNOWN_ISSUES.md` before continuing.

**Next up:** M1 runtime core - start with iso math (`packages/runtime/src/iso`), then scene/ECS, fixed timestep, input, PixiJS renderer with depth sort.

## Milestones

- [x] M0 Foundations (repo, workspaces, lint, typecheck, tests, CI, Electron window, state docs)
- [ ] M1 Runtime core (iso math, scene/ECS, renderer + depth sort, camera, input, fixed timestep)
- [ ] M2 Heights and collision (stairs, cliffs, pits, falling, occlusion fade)
- [ ] M3 Editor shell + world painter
- [ ] M4 Sprite studio
- [ ] M5 No-code logic (behaviours, inspector, event sheets, wires)
- [ ] M6 Echoes, light, puzzle parts
- [ ] M7 AI and combat
- [ ] M8 Story systems
- [ ] M9 Errors and debugging (problems panel, overlays, profiler, validators, playbot)
- [ ] M10 Code window
- [ ] M11 Claude assistant
- [ ] M12 Export and packaging
- [ ] M13 The acceptance game
- [ ] M14 Polish

## M0 sub-checklist

- [x] npm workspaces layout (`packages/*`)
- [x] TypeScript base config, ESLint flat config, Vitest config
- [x] Electron + Vite + React editor shell skeleton
- [x] `npm test` green (5 placeholder tests)
- [x] `npm run typecheck` green
- [x] `npm run lint` green
- [x] Playwright smoke test launches the Electron window and sees the welcome screen (verified locally, screenshot checked)
- [x] CI workflow written (ubuntu + windows-latest); not yet run, no remote repo
- [x] First commit
