import { defineConfig } from 'electron-vite'

// `?inline` imports of the hyphenation tries (vendor/hypher/*.bin, hyphenation-tries.ts): Vite
// only inlines file types it knows as assets.
export default defineConfig({ main: {}, preload: {}, renderer: { assetsInclude: ['**/*.bin'] } })
