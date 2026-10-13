/** Test-only production build. The fixture is never an input of the App build. */
import { defineConfig, mergeConfig } from 'vite';
import appConfig from '../../vite.config';

export default defineConfig(mergeConfig(appConfig, {
  build: {
    outDir: 'src/diagram/.qa/production',
    rolldownOptions: { input: 'src/diagram/browser-harness.html' },
  },
  preview: { host: '127.0.0.1', port: 4240, strictPort: true },
}));
