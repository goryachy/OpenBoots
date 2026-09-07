import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const httpsEnabled = env.VITE_HTTPS === 'true';
  return {
  plugins: [
    react(),
    ...(httpsEnabled ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'OpenBoots — склад',
        short_name: 'OpenBoots',
        description: 'Мобильный склад и продажи',
        theme_color: '#0d1412',
        background_color: '#f5f7f4',
        display: 'standalone',
        icons: []
      }
    })
  ],
  server: {
    port: 5173,
    host: process.env.VITE_HOST || '0.0.0.0',
    https: httpsEnabled ? {} : undefined,
    proxy: { '/api': process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001' },
  },
  build: { outDir: 'dist' }
  };
});
