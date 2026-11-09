import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * The renderer part of an exported game (the game window's page), built next to the editor and copied into every export.
 * index.html is the desktop game's page; web.html is the same player for a game exported to run in a web browser.
 */
export default defineConfig({
  root: 'src/player',
  base: './',
  build: {
    outDir: '../../dist/player',
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(__dirname, 'src/player/index.html'), web: resolve(__dirname, 'src/player/web.html') } },
  },
});
