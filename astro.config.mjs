import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import path from 'node:path';

export const prerender = false;

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  vite: {
    server: {
      // Exposes folder to npm run dev
      fs: { allow: [path.join(process.cwd(), 'uploads')] }
    },
    // Exposes folder to the final node production execution
    publicDir: path.join(process.cwd(), 'public')
  }
});
