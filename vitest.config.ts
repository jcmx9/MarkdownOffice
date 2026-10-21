import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'pipeline/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: [
        'src/main/**/*.ts',
        'src/renderer/**/*.ts',
        'src/shared/**/*.ts',
        'src/core/**/*.ts',
      ],
      // Electron/DOM wiring is covered by the Playwright suite.
      exclude: [
        'src/main/index.ts',
        'src/main/font-protocol.ts',
        'src/main/context.ts',
        'src/main/ipc.ts',
        'src/main/window.ts',
        'src/renderer/main.ts',
        'src/renderer/app.ts',
        'src/renderer/ui/**',
        'src/renderer/env.d.ts',
      ],
      thresholds: { lines: 80, branches: 80 },
    },
  },
})
