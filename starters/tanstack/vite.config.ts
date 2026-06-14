import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import tsConfigPaths from 'vite-tsconfig-paths'

// TanStack Start (v1) usa um plugin de Vite. O dev server roda na porta 5173
// (definida no script `dev`), que é a porta esperada pelo contrato do plugin Strapi.
export default defineConfig({
  plugins: [
    tsConfigPaths({ projects: ['./tsconfig.json'] }),
    tanstackStart(),
    react(),
  ],
})
