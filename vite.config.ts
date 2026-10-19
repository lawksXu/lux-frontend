import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'LUX_');
  const proxy = { '/api': { target: env.LUX_BACKEND_URL || 'http://127.0.0.1:8080', changeOrigin: true } };
  return {
    server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  };
});
