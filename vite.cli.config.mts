// Builds the `markdown-office` command (src/cli/) into one CommonJS file out/cli/cli.js. It runs
// under the app binary with ELECTRON_RUN_AS_NODE=1, so: Node built-ins only (external), no code
// splitting, target = Electron 44's Node (24), not minified so packaged errors stay readable.
// The leading comment block of src/cli/main.ts becomes the banner, so the shipped file still
// explains itself. Packaging ships out/cli/cli.js as <resources>/pipeline/cli.js
// (electron-builder.yml); the dev layout gets a copy from this build (devLayoutCopy below).
// `.mts`: Vite loads a `.ts` config as CommonJS here (no "type": "module") and warns on every build.
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(root, 'src', 'cli', 'main.ts')

function headerComment(file: string): string {
  const lines = readFileSync(file, 'utf8').split('\n')
  const end = lines.findIndex((line) => !line.startsWith('//'))
  return lines.slice(0, end === -1 ? lines.length : end).join('\n')
}

/**
 * After a build into <root>/out/cli, copies cli.js to <root>/build/pipeline-dev/pipeline/cli.js
 * when that dev layout exists (npm run assets). Why a copy written by the build: the dev layout
 * mirrors <resources>/pipeline, and a link to the build output would turn into a stale copy under
 * Git Bash on Windows (ln -s copies there) — rebuilding the CLI now always refreshes it. A former
 * symlink at that place is removed first, so the copy never writes through it. Builds elsewhere
 * (the bundle tests' temp folders) leave the dev layout alone; nothing is created without it.
 */
function devLayoutCopy(): Plugin {
  let projectRoot = ''
  let outDir = ''
  return {
    name: 'mdo-dev-layout-copy',
    apply: 'build',
    configResolved(config) {
      projectRoot = config.root
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      if (outDir !== path.join(projectRoot, 'out', 'cli')) return
      const built = path.join(outDir, 'cli.js')
      const devPipeline = path.join(projectRoot, 'build', 'pipeline-dev', 'pipeline')
      if (!existsSync(built) || !existsSync(devPipeline)) return
      const copy = path.join(devPipeline, 'cli.js')
      rmSync(copy, { force: true })
      copyFileSync(built, copy)
    },
  }
}

export default defineConfig({
  root,
  plugins: [devLayoutCopy()],
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
