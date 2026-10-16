# Building Tilewright on Windows

1. Install **Node.js LTS** (https://nodejs.org) and **Git**.
2. Clone the repository and open a terminal in its folder.
3. Install dependencies:
   ```
   npm ci
   ```
4. Run the editor in development mode:
   ```
   npm run dev
   ```
5. Build the editor as a Windows installer:
   ```
   npm run dist:win
   ```
   The installer (`Tilewright Setup x.y.z.exe`) and a portable `.zip` appear in `packages/editor/release/`.

Other checks: `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:e2e`.

> `dist:win` is wired up in M0 but not yet verified end to end; see `PROGRESS.md` (M12).
