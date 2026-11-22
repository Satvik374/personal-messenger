import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const root = import.meta.dirname

export default defineConfig({
  main: {
    // @pm/shared is source-linked in the workspace, so bundle it rather than
    // relying on node_modules resolution inside the packaged app.
    plugins: [externalizeDepsPlugin({ exclude: ['@pm/shared'] })],
    build: {
      rollupOptions: { input: resolve(root, 'src/main/index.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(root, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@ui': resolve(root, '../../packages/ui/src'),
      },
    },
    build: {
      rollupOptions: { input: resolve(root, 'src/renderer/index.html') },
    },
  },
})
