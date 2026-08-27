import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  // Relative asset URLs so the built app works from any static host location
  // (domain root, IIS virtual directory, portal sub-path) without a rebuild.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(`v${version}`)
  }
});
