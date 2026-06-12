import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const here = dirname(fileURLToPath(import.meta.url))
const mobile = resolve(here, '../mobile')
const harness = (f: string) => resolve(here, 'demo/harness', f)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Ensure a single React instance across the main app, the demo bundle, and
    // react-native-web (otherwise hooks blow up with a null dispatcher).
    dedupe: ['react', 'react-dom', 'react-native-web'],
    // These aliases only affect modules that import the matched specifiers.
    // The marketing site imports none of them, so they're a no-op for the main
    // app and only kick in for the demo bundles, which render real mobile-app
    // screens via react-native-web with mock data. Native/back-end modules are
    // swapped for the stubs under demo/harness. Order matters: most specific
    // finds first (first match wins).
    alias: [
      { find: '@react-native-async-storage/async-storage', replacement: resolve(here, 'demo/stubs/async-storage.ts') },
      // Demo harness stubs (mock backend / native deps):
      { find: '@services/api/convex', replacement: harness('convex.tsx') },
      { find: '@/services/api/convex', replacement: harness('convex.tsx') },
      { find: '@/services/environment', replacement: harness('environment.ts') },
      { find: '@services/environment', replacement: harness('environment.ts') },
      { find: '@/providers/AuthProvider', replacement: harness('AuthProvider.tsx') },
      { find: '@providers/AuthProvider', replacement: harness('AuthProvider.tsx') },
      { find: '@expo/vector-icons', replacement: harness('vector-icons.tsx') },
      { find: '@togather/shared/utils', replacement: harness('togather-shared-utils.ts') },
      { find: '@togather/shared', replacement: harness('togather-shared.ts') },
      { find: 'expo-router', replacement: harness('expo-router.tsx') },
      { find: 'expo-web-browser', replacement: harness('expo-web-browser.ts') },
      { find: 'react-native-gesture-handler', replacement: harness('gesture-handler.tsx') },
      { find: 'react-native-reanimated', replacement: harness('reanimated.tsx') },
      { find: 'react-native-safe-area-context', replacement: harness('safe-area.tsx') },
      // react-native -> react-native-web (exact, so it doesn't catch the libs above):
      { find: /^react-native$/, replacement: 'react-native-web' },
      // Mobile path aliases:
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
        'demo-community-selection': resolve(here, 'demo/community-selection.html'),
        'demo-prayer-feed': resolve(here, 'demo/prayer-feed.html'),
      },
    },
  },
})
