import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bashFor } from '../../../scripts/dev-layout.mjs'

const ROOT = join(__dirname, '../../..')

describe('bashFor', () => {
  it('uses bash from PATH on macOS and Linux', () => {
    expect(bashFor('darwin', {}, () => true)).toBe('bash')
    expect(bashFor('linux', { ProgramFiles: '/x' }, () => true)).toBe('bash')
  })

  it("prefers Git for Windows' bash over whatever cmd.exe finds", () => {
    const git = join('C:\\Program Files', 'Git', 'bin', 'bash.exe')
    expect(bashFor('win32', { ProgramFiles: 'C:\\Program Files' }, (p) => p === git)).toBe(git)
  })

  it('falls back to bash from PATH when Git for Windows is missing', () => {
    expect(bashFor('win32', { ProgramFiles: 'C:\\Program Files' }, () => false)).toBe('bash')
  })
})

// `npm run build:cli` writes out/cli/cli.js and, when the dev layout exists, also its copy
// build/pipeline-dev/pipeline/cli.js — so the dev layout can never run a stale CLI (Git Bash on
// Windows copies instead of linking). The real vite.cli.config.mts runs against a temp project
// root (its own out/ and build/ folders) with a small stand-in entry.
describe('CLI build → dev layout copy', () => {
  let dir = ''
  let entry = ''
  let out = ''
  let devPipeline = ''
  let devCli = ''

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'mdo cli dev ')))
    entry = join(dir, 'main.ts')
    out = join(dir, 'out', 'cli', 'cli.js')
    devPipeline = join(dir, 'build', 'pipeline-dev', 'pipeline')
    devCli = join(devPipeline, 'cli.js')
    writeSource('first')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function writeSource(marker: string): void {
    writeFileSync(entry, `// stand-in entry\nconsole.log('stand-in ${marker}')\n`)
  }

  const buildCli = (outDir = join(dir, 'out', 'cli')) =>
    build({
      configFile: join(ROOT, 'vite.cli.config.mts'),
      root: dir,
      logLevel: 'silent',
      build: { outDir, lib: { entry } },
    })

  it('copies out/cli/cli.js into the dev layout as a regular file, byte for byte', async () => {
    mkdirSync(devPipeline, { recursive: true })
    await buildCli()
    expect(lstatSync(devCli).isFile()).toBe(true)
    expect(readFileSync(devCli)).toEqual(readFileSync(out))
    expect(readFileSync(devCli, 'utf8')).toContain('stand-in first')
  })

  it('updates the copy when the source changed and the CLI is built again', async () => {
    mkdirSync(devPipeline, { recursive: true })
    await buildCli()
    writeSource('second')
    await buildCli()
    expect(readFileSync(devCli, 'utf8')).toContain('stand-in second')
    expect(readFileSync(devCli)).toEqual(readFileSync(out))
  })

  it.skipIf(process.platform === 'win32')(
    'replaces an old symlink (former dev layout) instead of writing through it',
    async () => {
      mkdirSync(devPipeline, { recursive: true })
      const target = join(dir, 'pipeline', 'cli.js')
      symlinkSync(target, devCli)
      await buildCli()
      expect(lstatSync(devCli).isFile()).toBe(true)
      expect(existsSync(target)).toBe(false)
    },
  )

  it('creates no dev layout when there is none (npm run assets not run yet)', async () => {
    await buildCli()
    expect(existsSync(out)).toBe(true)
    expect(existsSync(join(dir, 'build'))).toBe(false)
  })

  it('leaves the dev layout alone when building somewhere else (tests)', async () => {
    mkdirSync(devPipeline, { recursive: true })
    await buildCli(join(dir, 'elsewhere'))
    expect(existsSync(join(dir, 'elsewhere', 'cli.js'))).toBe(true)
    expect(existsSync(devCli)).toBe(false)
  })
})
