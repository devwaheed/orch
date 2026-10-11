import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // The window loads the build over file:// (SEC-02: bundled pages only), so asset URLs must be relative.
  base: './',
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
