import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The API port is overridable so a second checkout can run next to the first
// (`API_PORT=3010 pnpm dev:web` with `PORT=3010 pnpm dev:api`).
const api = `http://localhost:${process.env.API_PORT ?? '3000'}`;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      // Remote MCP endpoint + its OAuth discovery documents (server/mcp/).
      '/mcp': api,
      '/.well-known': api,
    },
  },
});
