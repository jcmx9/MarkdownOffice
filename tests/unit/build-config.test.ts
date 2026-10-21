import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { adHocOptions, bundledTypst, withRetry } from '../../scripts/adhoc-sign.mjs'

// js-yaml is the parser electron-builder itself uses (also an explicit devDependency), so the
// test reads the file exactly as the packager does.
const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load: (text: string) => unknown }

const root = resolve(__dirname, '../..')
const configPath = join(root, 'electron-builder.yml')

interface Target {
  target: string
  arch: string[]
}

interface BuilderConfig {
  appId: string
  productName: string
  directories: { output: string; buildResources: string }
  files: string[]
  artifactName: string
  mac: {
    target: Target[]
    identity: string
    sign: string
    hardenedRuntime: boolean
    category: string
  }
  win: { target: Target[] }
  linux: { target: Target[]; category: string }
  fileAssociations: { ext: string; name: string; role: string }[]
  extraResources: { from: string; to: string; filter?: string[] }[]
}

function loadConfig(): BuilderConfig {
  expect(existsSync(configPath)).toBe(true)
  return yaml.load(readFileSync(configPath, 'utf8')) as BuilderConfig
}

describe('electron-builder.yml', () => {
  it('names the app Markdown Office with a stable app id', () => {
    const config = loadConfig()
    expect(config.appId).toBe('io.github.jcmx9.markdownoffice')
    expect(config.productName).toBe('Markdown Office')
  })

  it('builds into dist/ with version, os and arch in the archive name', () => {
    const config = loadConfig()
    expect(config.directories).toEqual({ output: 'dist', buildResources: 'build' })
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder macros, not JS
    expect(config.artifactName).toBe('markdown-office-${version}-${os}-${arch}.${ext}')
  })

  it('ships only the built app and package.json, never scripts, tests, source maps or a second CLI copy', () => {
    const config = loadConfig()
    expect(config.files).toEqual(['out/**', 'package.json', '!**/*.map', '!out/cli/**'])
    // The CLI ships once, as <resources>/pipeline/cli.js, not also inside app.asar.
    expect(config.files).toContain('!out/cli/**')
    expect(config.files.some((f) => f.startsWith('scripts') || f.startsWith('tests'))).toBe(false)
  })

  it('targets an ad-hoc signed zip on macOS (arm64 + x64), a zip on Windows, an AppImage on Linux', () => {
    const config = loadConfig()
    expect(config.mac.target).toEqual([{ target: 'zip', arch: ['arm64', 'x64'] }])
    expect(config.mac.identity).toBe('-')
    expect(config.mac.sign).toBe('./scripts/adhoc-sign.mjs')
    // Ad-hoc + hardened runtime: library validation rejects the Electron Framework (no team ID).
    expect(config.mac.hardenedRuntime).toBe(false)
    expect(config.mac.category).toBe('public.app-category.productivity')
    expect(config.win.target).toEqual([{ target: 'zip', arch: ['x64'] }])
    expect(config.linux.target).toEqual([{ target: 'AppImage', arch: ['x64'] }])
    expect(config.linux.category).toBe('Office')
  })

  it('registers Markdown Office as an editor for .md files', () => {
    const config = loadConfig()
    expect(config.fileAssociations).toEqual([{ ext: 'md', name: 'Markdown', role: 'Editor' }])
  })

  it('ships only an allowlist of the pipeline folder (no tests, no fonts or vendor copies)', () => {
    const entry = loadConfig().extraResources.find((r) => r.from === 'pipeline')
    expect(entry?.to).toBe('pipeline')
    expect(entry?.filter).toEqual(['build.sh', 'convert.ps1', 'lib/**/*', 'logo.svg', 'example.md'])
    expect(entry?.filter?.some((f) => f.includes('*') && !f.startsWith('lib/'))).toBe(false)
  })

  // The CLI is built from src/cli/ (npm run build:cli → out/cli/cli.js), not kept in pipeline/.
  it('ships the bundled CLI as pipeline/cli.js', () => {
    const entry = loadConfig().extraResources.find((r) => r.from === 'out/cli/cli.js')
    expect(entry?.to).toBe('pipeline/cli.js')
  })

  it('ships the licence texts as pipeline/licenses', () => {
    const entry = loadConfig().extraResources.find(
      (r) => r.from === 'build/pipeline-assets/licenses',
    )
    expect(entry?.to).toBe('pipeline/licenses')
  })

  it('names only files that exist in pipeline/', () => {
    const entry = loadConfig().extraResources.find((r) => r.from === 'pipeline')
    for (const f of entry?.filter ?? []) {
      expect(existsSync(join(root, 'pipeline', f.replace('/**/*', '')))).toBe(true)
    }
  })

  it("passes electron-builder's own schema validation", async () => {
    const { validateConfiguration } = require('app-builder-lib/out/util/config/config') as {
      validateConfiguration: (config: unknown, logger: unknown) => Promise<void>
    }
    const { DebugLogger } = require('builder-util') as {
      DebugLogger: new (enabled: boolean) => unknown
    }
    await expect(
      validateConfiguration(loadConfig(), new DebugLogger(false)),
    ).resolves.toBeUndefined()
  })

  it('is wired to npm run dist without publishing', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(pkg.scripts.dist).toBe(
      'node scripts/fetch-pipeline-assets.mjs && npm run build && electron-builder --publish never',
    )
    expect(pkg.scripts.assets).toBe(
      'node scripts/fetch-pipeline-assets.mjs && node scripts/dev-layout.mjs && npm run build:cli',
    )
    expect(pkg.devDependencies['electron-builder']).toMatch(/^\^\d+\.\d+\.\d+$/)
  })
})

describe('adHocOptions (mac.sign hook)', () => {
  it('forces the ad-hoc identity even when electron-builder picked a keychain certificate', () => {
    const opts = { app: '/x/Markdown Office.app', identity: 'E0184918', identityValidation: true }
    expect(adHocOptions(opts)).toMatchObject({
      app: '/x/Markdown Office.app',
      identity: '-',
      identityValidation: false,
    })
  })

  it('lists the bundled Typst as an extra binary to sign, exactly once', () => {
    const typst = join(
      '/x/Markdown Office.app',
      'Contents',
      'Resources',
      'pipeline',
      'bin',
      'typst',
    )
    expect(bundledTypst('/x/Markdown Office.app')).toBe(typst)
    expect(adHocOptions({ app: '/x/Markdown Office.app' }).binaries).toEqual([typst])
    expect(
      adHocOptions({ app: '/x/Markdown Office.app', binaries: ['/x/other'] }).binaries,
    ).toEqual(['/x/other', typst])
    expect(adHocOptions({ app: '/x/Markdown Office.app', binaries: [typst] }).binaries).toEqual([
      typst,
    ])
  })
})

describe('withRetry (codesign is flaky on CI runners)', () => {
  it('retries a failing signature and returns the first success', async () => {
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('resource busy'))
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValue('signed')
    const log = vi.fn()
    await expect(withRetry(task, { delayMs: 0, log })).resolves.toBe('signed')
    expect(task).toHaveBeenCalledTimes(3)
    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0]?.[0]).toContain('resource busy')
  })

  it('gives up after three attempts with the last error', async () => {
    const task = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('codesign failed'))
    await expect(withRetry(task, { delayMs: 0, log: () => undefined })).rejects.toThrow(
      'codesign failed',
    )
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('does not retry a success', async () => {
    const task = vi.fn<() => Promise<number>>().mockResolvedValue(1)
    await expect(withRetry(task, { delayMs: 0 })).resolves.toBe(1)
    expect(task).toHaveBeenCalledTimes(1)
  })
})

// Every packaging or e2e path must build the CLI too, or the app ships without pipeline/cli.js
// (after-pack would stop it, but only at the very end).
describe('npm scripts build the CLI bundle', () => {
  const scripts = () =>
    (
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>
      }
    ).scripts

  it('builds it with vite.cli.config.mts, after the app', () => {
    expect(scripts()['build:cli']).toBe('vite build --config vite.cli.config.mts')
    expect(scripts().build).toBe('electron-vite build && npm run build:cli')
  })

  it('runs the full build before e2e tests', () => {
    expect(scripts()['test:e2e']).toBe('npm run build && playwright test')
  })
})

describe('build-time dependencies', () => {
  it('declares what the sign hook and these tests load instead of relying on hoisting', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    expect(Object.keys(pkg.devDependencies)).toEqual(
      expect.arrayContaining(['@electron/osx-sign', 'js-yaml']),
    )
  })
})
