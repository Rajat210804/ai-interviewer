import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development the API runs separately on port 3001; in production Express serves this build.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The face-check library (about 1.3 MB) is its own chunk and only loads for proctored interviews.
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    proxy: { '/api': 'http://localhost:3001' },
  },
});
