import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // The engine and the plugins that ship with it are one chunk: split apart, the editor's own chunks and the engine's
        // would import each other and run before the other had set up.
        codeSplitting: {
          groups: [{ name: 'engine', test: /[\\/]packages[\\/](runtime|behaviors|playbot|plugin-sdk|bundled-plugins|plugins)[\\/]/, priority: 20 }],
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
