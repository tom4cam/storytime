import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config: standard React setup. The Netlify dev server proxies
// /.netlify/functions/* to the local functions runtime, so no proxy needed here.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
