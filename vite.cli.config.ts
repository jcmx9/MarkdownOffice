// Builds the `markdown-office` command (src/cli/) into one CommonJS file out/cli/cli.js. It runs
// under the app binary with ELECTRON_RUN_AS_NODE=1, so: Node built-ins only (external), no code
// splitting, target = Electron 44's Node (24), not minified so packaged errors stay readable.
// The leading comment block of src/cli/main.ts becomes the banner, so the shipped file still
// explains itself.
import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(root, 'src', 'cli', 'main.ts')

function headerComment(file: string): string {
  const lines = readFileSync(file, 'utf8').split('\n')
  const end = lines.findIndex((line) => !line.startsWith('//'))
  return lines.slice(0, end === -1 ? lines.length : end).join('\n')
}

export default defineConfig({
  root,
  publicDir: false,
  logLevel: 'warn',
  build: {
    target: 'node24',
    outDir: path.join(root, 'out', 'cli'),
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      entry,
      formats: ['cjs'],
      fileName: () => 'cli.js',
    },
    rollupOptions: {
      external: [/^node:/, ...builtinModules],
      output: { banner: headerComment(entry) },
    },
  },
})
