import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'OpenBoots Inventory',
        short_name: 'OpenBoots',
        description: 'Мобильный склад и продажи',
        theme_color: '#0d1412',
        background_color: '#f5f7f4',
        display: 'standalone',
        icons: []
      }
    })
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist' }
});
