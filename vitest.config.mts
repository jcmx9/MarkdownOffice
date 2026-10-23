import { defineConfig } from 'vitest/config'

export default defineConfig({
  // as electron.vite.config.ts: the renderer imports the hyphenation tries with `?inline`
  assetsInclude: ['**/*.bin'],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: [
        'src/main/**/*.ts',
        'src/renderer/**/*.ts',
        'src/shared/**/*.ts',
        'src/core/**/*.ts',
        'src/cli/**/*.ts',
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
        // The CLI's process wiring runs only as the bundled cli.js in a child process
        // (tests/unit/cli/bundle.test.ts), which v8 coverage does not see.
        'src/cli/main.ts',
      ],
      thresholds: { lines: 80, branches: 80 },
    },
  },
})
