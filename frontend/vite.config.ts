import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    /**
     * The client always calls `/api/v1/...` on its own origin. In development this
     * proxy forwards that to the API, so the request is same-origin here exactly as
     * it is in production, where one process serves both.
     */
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
