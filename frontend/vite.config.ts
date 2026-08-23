import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The API base URL comes from the environment, never from a hard-coded string,
 * so the same build process works against localhost, staging or production.
 *
 * In development the proxy below forwards /api to the backend, which keeps the
 * browser on a single origin and sidesteps CORS entirely.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_PROXY_TARGET || 'http://localhost:3000';

  return {
    plugins: [react()],
    server: {
      port: Number(env.VITE_PORT) || 5173,
      proxy: {
        '/api': { target, changeOrigin: true },
      },
    },
    build: { outDir: 'dist', sourcemap: 'hidden' },
  };
});
