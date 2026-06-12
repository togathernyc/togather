import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const here = dirname(fileURLToPath(import.meta.url))
const mobile = resolve(here, '../mobile')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Ensure a single React instance across the main app, the demo bundle, and
    // react-native-web (otherwise hooks blow up with a null dispatcher).
    dedupe: ['react', 'react-dom', 'react-native-web'],
    // These aliases only affect modules that import the matched specifiers.
    // The marketing site doesn't import react-native or @hooks/@providers, so
    // they're a no-op for the main app and only kick in for the demo bundle,
    // which renders real mobile-app components via react-native-web with mock
    // data. Order matters: more specific finds first.
    alias: [
      { find: '@react-native-async-storage/async-storage', replacement: resolve(here, 'demo/stubs/async-storage.ts') },
      { find: /^react-native$/, replacement: 'react-native-web' },
      { find: '@hooks', replacement: resolve(mobile, 'hooks') },
      { find: '@providers', replacement: resolve(mobile, 'providers') },
      { find: '@components', replacement: resolve(mobile, 'components') },
      { find: '@features', replacement: resolve(mobile, 'features') },
      { find: '@services', replacement: resolve(mobile, 'services') },
      { find: '@utils', replacement: resolve(mobile, 'utils') },
      { find: '@', replacement: mobile },
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        'demo-community-selector': resolve(here, 'demo/community-selector.html'),
      },
    },
  },
})
