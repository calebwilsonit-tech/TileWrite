import { defineConfig } from 'vite';

/** The renderer part of an exported game (the game window's page), built next to the editor and copied into every export. */
export default defineConfig({
  root: 'src/player',
  base: './',
  build: {
    outDir: '../../dist/player',
    emptyOutDir: true,
  },
});
