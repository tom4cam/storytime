import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config: standard React setup. `wrangler pages dev` serves the
// built app alongside the Pages Functions in functions/api/, so no proxy
// is needed here.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
