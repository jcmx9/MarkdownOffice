import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AppUpdater,
  ARCHIVE_MAX_BYTES,
  autoCheckDue,
  bootstrapUrl,
  compareVersions,
  EMPTY_STATE,
  HELPER_SH,
  helperCommand,
  type InstallLocation,
  installLocation,
  isReleaseVersion,
  type LocationEnv,
  looksLikeBootstrap,
  parseLatestRelease,
  releaseAsset,
  releaseFileUrl,
  SCRIPT_MAX_BYTES,
  sanitizeState,
  settlePending,
  sumFor,
  type UpdaterDeps,
  updatesSupported,
} from '../../../src/main/app-update'

const DAY = 24 * 60 * 60 * 1000

describe('versions', () => {
  it('accepts only stable CalVer', () => {
    expect(isReleaseVersion('26.10.6')).toBe(true)
    expect(isReleaseVersion('26.1.0')).toBe(true)
    for (const v of ['26.10.6-dev.0', 'v26.10.6', '26.10', '2026.10.1', '26.10.6; rm -rf', ''])
      expect(isReleaseVersion(v)).toBe(false)
  })

  it('compares numerically, not as text', () => {
    expect(compareVersions('26.10.10', '26.10.9')).toBeGreaterThan(0)
    expect(compareVersions('26.9.3', '26.10.0')).toBeLessThan(0)
    expect(compareVersions('27.1.0', '26.12.9')).toBeGreaterThan(0)
    expect(compareVersions('26.10.6', '26.10.6')).toBe(0)
    expect(compareVersions('26.10.7-dev.0', '26.10.7')).toBe(0)
  })

  it('offers updates only to packaged release builds', () => {
    expect(updatesSupported(true, '26.10.6')).toBe(true)
    expect(updatesSupported(false, '26.10.6')).toBe(false)
    expect(updatesSupported(true, '26.10.7-dev.0')).toBe(false)
  })
})

describe('parseLatestRelease', () => {
  const page = 'https://github.com/jcmx9/MarkdownOffice/releases/tag/v26.10.7'

  it('reads tag and page', () => {
    expect(parseLatestRelease({ tag_name: 'v26.10.7', html_url: page })).toEqual({
      version: '26.10.7',
      url: page,
    })
  })

  it('refuses drafts, pre-releases and odd tags', () => {
    expect(parseLatestRelease({ tag_name: 'v26.10.7', prerelease: true })).toBeNull()
    expect(parseLatestRelease({ tag_name: 'v26.10.7', draft: true })).toBeNull()
    expect(parseLatestRelease({ tag_name: 'v26.10.7-dev.1' })).toBeNull()
    expect(parseLatestRelease({ tag_name: 'latest' })).toBeNull()
    expect(parseLatestRelease(null)).toBeNull()
    expect(parseLatestRelease('x')).toBeNull()
  })

  it('never takes a foreign page link', () => {
    expect(
      parseLatestRelease({ tag_name: 'v26.10.7', html_url: 'https://evil.example/x' })?.url,
    ).toBe(page)
  })
})

describe('state', () => {
  it('drops invalid values', () => {
    expect(sanitizeState({ lastCheck: 'x', skipped: '1; x', pending: 26 })).toEqual(EMPTY_STATE)
    expect(sanitizeState({ lastCheck: 5, skipped: '26.10.7', pending: '26.10.8' })).toEqual({
      lastCheck: 5,
      skipped: '26.10.7',
      pending: '26.10.8',
    })
  })

  it('checks at most once a day, and again after the clock went back', () => {
    const s = { ...EMPTY_STATE, lastCheck: 10 * DAY }
    expect(autoCheckDue(s, 10 * DAY + DAY - 1)).toBe(false)
    expect(autoCheckDue(s, 11 * DAY)).toBe(true)
    expect(autoCheckDue(s, 9 * DAY)).toBe(true)
  })

  it('settles a pending install against the running version', () => {
    expect(settlePending(EMPTY_STATE, '26.10.7')).toBeNull()
    expect(settlePending({ ...EMPTY_STATE, pending: '26.10.7' }, '26.10.7')).toEqual({
      kind: 'updated',
      version: '26.10.7',
    })
    expect(settlePending({ ...EMPTY_STATE, pending: '26.10.7' }, '26.10.6')).toEqual({
      kind: 'failed',
      version: '26.10.7',
    })
  })
})

function env(o: Partial<LocationEnv> & Pick<LocationEnv, 'platform' | 'execPath'>): LocationEnv {
  return {
    home: '/Users/u',
    read: async () => null,
    exists: async () => false,
    ...o,
  }
}

describe('installLocation', () => {
  const bundle = '/Users/u/Applications/Markdown Office.app'
  const macExe = `${bundle}/Contents/MacOS/Markdown Office`

  it('macOS default install: marker in the data folder names the bundle', async () => {
    const files: Record<string, string> = {
      '/Users/u/.local/share/markdown-office/.mdo-install': `${bundle}\n`,
    }
    const loc = await installLocation(
      env({ platform: 'darwin', execPath: macExe, read: async (p) => files[p] ?? null }),
    )
    expect(loc).toEqual({ platform: 'darwin', mdoHome: null, relaunch: ['/usr/bin/open', bundle] })
  })

  it('macOS honours XDG_DATA_HOME like the bootstrap', async () => {
    const files: Record<string, string> = { '/x/markdown-office/.mdo-install': bundle }
    const loc = await installLocation(
      env({
        platform: 'darwin',
        execPath: macExe,
        xdgDataHome: '/x',
        read: async (p) => files[p] ?? null,
      }),
    )
    expect(loc?.mdoHome).toBeNull()
  })

  it('macOS MDO_HOME install: marker next to the bundle', async () => {
    const b = '/opt/mdo/Markdown Office.app'
    const files: Record<string, string> = { '/opt/mdo/.mdo-install': b }
    const loc = await installLocation(
      env({
        platform: 'darwin',
        execPath: `${b}/Contents/MacOS/Markdown Office`,
        read: async (p) => files[p] ?? null,
      }),
    )
    expect(loc).toEqual({ platform: 'darwin', mdoHome: '/opt/mdo', relaunch: ['/usr/bin/open', b] })
  })

  it('macOS without a matching marker, or a renamed app: no self-update', async () => {
    const other: Record<string, string> = {
      '/Users/u/.local/share/markdown-office/.mdo-install': '/Applications/Markdown Office.app',
    }
    expect(
      await installLocation(
        env({ platform: 'darwin', execPath: macExe, read: async (p) => other[p] ?? null }),
      ),
    ).toBeNull()
    expect(
      await installLocation(
        env({
          platform: 'darwin',
          execPath: '/Users/u/Applications/Mine.app/Contents/MacOS/Markdown Office',
          read: async () => bundle,
        }),
      ),
    ).toBeNull()
    // The default marker only counts for the default place (~/Applications).
    const elsewhere = '/Applications/Markdown Office.app'
    expect(
      await installLocation(
        env({
          platform: 'darwin',
          execPath: `${elsewhere}/Contents/MacOS/Markdown Office`,
          read: async (p) =>
            p === '/Users/u/.local/share/markdown-office/.mdo-install' ? elsewhere : null,
        }),
      ),
    ).toBeNull()
  })

  it('Linux: extracted app with marker; relaunch through the command shim', async () => {
    const exe = '/home/u/.local/share/markdown-office/app/markdown-office'
    const have = new Set([
      '/home/u/.local/share/markdown-office/app/.mdo-install',
      '/home/u/.local/bin/markdown-office',
    ])
    const loc = await installLocation(
      env({ platform: 'linux', home: '/home/u', execPath: exe, exists: async (p) => have.has(p) }),
    )
    expect(loc).toEqual({
      platform: 'linux',
      mdoHome: '/home/u/.local/share/markdown-office',
      relaunch: ['/home/u/.local/bin/markdown-office', '--app'],
    })
  })

  it('Linux: no marker (AppImage run by hand) → null', async () => {
    expect(
      await installLocation(env({ platform: 'linux', execPath: '/tmp/.mount_x/markdown-office' })),
    ).toBeNull()
  })

  it('Windows: exe folder with marker', async () => {
    const exe = 'C:\\Users\\u\\AppData\\Local\\Markdown Office\\Markdown Office.exe'
    const loc = await installLocation(
      env({
        platform: 'win32',
        execPath: exe,
        exists: async (p) => p === 'C:\\Users\\u\\AppData\\Local\\Markdown Office\\.mdo-install',
      }),
    )
    expect(loc).toEqual({
      platform: 'win32',
      mdoHome: 'C:\\Users\\u\\AppData\\Local\\Markdown Office',
      relaunch: [exe],
    })
    expect(await installLocation(env({ platform: 'win32', execPath: exe }))).toBeNull()
  })
})

describe('bootstrap script', () => {
  it('is pinned to the release tag', () => {
    expect(bootstrapUrl('darwin', '26.10.7')).toBe(
      'https://raw.githubusercontent.com/jcmx9/MarkdownOffice/v26.10.7/scripts/bootstrap.sh',
    )
    expect(bootstrapUrl('win32', '26.10.7')).toMatch(/\/v26\.10\.7\/scripts\/bootstrap\.ps1$/)
    expect(() => bootstrapUrl('linux', '26.10.7/../main')).toThrow()
  })

  it('must look like ours', () => {
    expect(looksLikeBootstrap('linux', '#!/usr/bin/env bash\n# Markdown Office')).toBe(true)
    expect(looksLikeBootstrap('linux', '<html>404 Markdown Office')).toBe(false)
    expect(looksLikeBootstrap('win32', '<#\n.SYNOPSIS\n  Markdown Office')).toBe(true)
    expect(looksLikeBootstrap('win32', '#!/usr/bin/env bash\nMarkdown Office')).toBe(false)
  })
})

/** Archive, sums and pid file of a helper run inside `dir`. */
async function files(dir: string) {
  const archive = join(dir, 'a.zip')
  const sums = join(dir, 'SHA256SUMS')
  await writeFile(archive, 'zip')
  await writeFile(sums, 'sums')
  return { archive, sums, pidFile: join(dir, 'update.pid') }
}

describe('release files', () => {
  it('names the archive as the bootstrap does', () => {
    expect(releaseAsset('darwin', 'arm64', '26.10.7')).toBe('markdown-office-26.10.7-mac-arm64.zip')
    expect(releaseAsset('darwin', 'x64', '26.10.7')).toBe('markdown-office-26.10.7-mac-x64.zip')
    expect(releaseAsset('linux', 'x64', '26.10.7')).toBe(
      'markdown-office-26.10.7-linux-x86_64.AppImage',
    )
    expect(releaseAsset('win32', 'x64', '26.10.7')).toBe('markdown-office-26.10.7-win-x64.zip')
    expect(releaseAsset('linux', 'arm64', '26.10.7')).toBeNull()
    expect(() => releaseAsset('linux', 'x64', '26.10.7/../x')).toThrow()
    expect(releaseFileUrl('26.10.7', 'SHA256SUMS')).toBe(
      'https://github.com/jcmx9/MarkdownOffice/releases/download/v26.10.7/SHA256SUMS',
    )
  })

  it('reads the sum of one file from SHA256SUMS', () => {
    const a = 'a'.repeat(64)
    const b = 'B'.repeat(64)
    const sums = `${a}  x.zip\r\n${b} *y.zip\nnot a line\n`
    expect(sumFor(sums, 'x.zip')).toBe(a)
    expect(sumFor(sums, 'y.zip')).toBe('b'.repeat(64))
    expect(sumFor(sums, 'z.zip')).toBeNull()
    expect(sumFor(sums, 'x')).toBeNull()
  })

  it('caps the archive size', () => {
    expect(ARCHIVE_MAX_BYTES).toBeGreaterThan(200 * 1024 * 1024)
  })
})

describe('helperCommand', () => {
  const mac: InstallLocation = {
    platform: 'darwin',
    mdoHome: null,
    relaunch: ['/usr/bin/open', '/Users/u/Applications/Markdown Office.app'],
  }

  it('macOS/Linux: constant sh script, every value a positional argument', () => {
    const c = helperCommand(mac, {
      pid: 42,
      script: '/t/b.sh',
      version: '26.10.7',
      log: '/l',
      archive: '/t/a.zip',
      sums: '/t/SHA256SUMS',
      pidFile: '/u/update.pid',
    })
    expect(c.command).toBe('/bin/sh')
    expect(c.args).toEqual([
      '-c',
      HELPER_SH,
      'sh',
      '42',
      '/t/b.sh',
      '26.10.7',
      '/l',
      '/t/a.zip',
      '/t/SHA256SUMS',
      '/u/update.pid',
      '/usr/bin/open',
      '/Users/u/Applications/Markdown Office.app',
    ])
    expect(c.mdoHome).toBeNull()
  })

  it('Windows: the written helper with named parameters', () => {
    const win: InstallLocation = { platform: 'win32', mdoHome: 'C:\\M', relaunch: ['C:\\M\\M.exe'] }
    const c = helperCommand(win, {
      pid: 7,
      script: 'C:\\t\\bootstrap.ps1',
      version: '26.10.7',
      log: 'C:\\l',
      archive: 'C:\\t\\a.zip',
      sums: 'C:\\t\\SHA256SUMS',
      pidFile: 'C:\\u\\update.pid',
      helper: 'C:\\t\\update-helper.ps1',
    })
    expect(c.command).toBe('powershell.exe')
    expect(c.args.slice(c.args.indexOf('-File'))).toEqual([
      '-File',
      'C:\\t\\update-helper.ps1',
      '-AppPid',
      '7',
      '-Script',
      'C:\\t\\bootstrap.ps1',
      '-Version',
      '26.10.7',
      '-Log',
      'C:\\l',
      '-Exe',
      'C:\\M\\M.exe',
      '-Archive',
      'C:\\t\\a.zip',
      '-Sums',
      'C:\\t\\SHA256SUMS',
      '-PidFile',
      'C:\\u\\update.pid',
    ])
    expect(c.mdoHome).toBe('C:\\M')
  })

  it.skipIf(process.platform === 'win32')(
    'the sh helper and its download survive TERM and HUP to the whole group, and log them',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'mdo-helper-'))
      const script = join(dir, 'bootstrap.sh')
      const log = join(dir, 'update.log')
      const started = join(dir, 'started')
      // A slow fake bootstrap: the signals arrive while it "downloads".
      await writeFile(script, 'sleep 1\necho "download done"\nexit 0\n')
      const loc: InstallLocation = {
        platform: 'linux',
        mdoHome: null,
        relaunch: ['touch', started],
      }
      const c = helperCommand(loc, {
        pid: 999_999,
        script,
        version: '26.10.7',
        log,
        ...(await files(dir)),
      })
      const child = spawn(c.command, c.args, { detached: true, stdio: 'ignore' })
      await vi.waitFor(async () => expect(await readFile(log, 'utf8')).toContain('started'))
      // While it runs, the pid file names the helper (an app started now steps aside).
      expect(Number(await readFile(join(dir, 'update.pid'), 'utf8'))).toBe(child.pid)
      await new Promise((r) => setTimeout(r, 200))
      process.kill(-(child.pid as number), 'SIGTERM')
      process.kill(-(child.pid as number), 'SIGHUP')
      await vi.waitFor(async () => expect(await readFile(started, 'utf8')).toBe(''), {
        timeout: 5000,
      })
      const text = await readFile(log, 'utf8')
      expect(text).toContain('mdo-update: signal TERM ignored')
      expect(text).toContain('mdo-update: signal HUP ignored')
      expect(text).toContain('download done')
      expect(text).toContain('mdo-update: exit 0')
    },
  )

  it.skipIf(process.platform === 'win32')(
    'the sh helper runs the script with the version, logs and relaunches',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'mdo-helper-'))
      const script = join(dir, 'bootstrap.sh')
      const log = join(dir, 'update.log')
      const started = join(dir, 'started')
      // A fake bootstrap: says "still running" (12) once, then succeeds.
      await writeFile(
        script,
        `n="$(cat "${dir}/n" 2>/dev/null || echo 0)"; echo $((n + 1)) >"${dir}/n"\n` +
          `echo "args: $*"; [ "$n" = 0 ] && exit 12; exit 0\n`,
      )
      const loc: InstallLocation = {
        platform: 'linux',
        mdoHome: null,
        relaunch: ['touch', started],
      }
      // A pid that is not running: the helper does not wait.
      const c = helperCommand(loc, {
        pid: 999_999,
        script,
        version: '26.10.7',
        log,
        ...(await files(dir)),
      })
      execFileSync(c.command, c.args)
      await vi.waitFor(async () => expect(await readFile(started, 'utf8')).toBe(''))
      const text = await readFile(log, 'utf8')
      expect(text).toContain(`args: --version 26.10.7 --archive ${join(dir, 'a.zip')} --sums`)
      expect(text).toContain('mdo-update: exit 0')
      expect(text.match(/mdo-update: bootstrap/g)).toHaveLength(2)
      // The downloaded files and the pid file are removed afterwards.
      for (const f of ['bootstrap.sh', 'a.zip', 'SHA256SUMS', 'update.pid'])
        await expect(access(join(dir, f))).rejects.toThrow()
    },
    15_000,
  )

  it('refuses a version that is not a release', () => {
    expect(() =>
      helperCommand(mac, {
        pid: 1,
        script: 's',
        version: '26.10.7 && x',
        log: 'l',
        archive: 'a',
        sums: 's',
        pidFile: 'p',
      }),
    ).toThrow()
  })
})

const release = (version: string) =>
  new Response(
    JSON.stringify({
      tag_name: `v${version}`,
      html_url: `https://github.com/jcmx9/MarkdownOffice/releases/tag/v${version}`,
    }),
  )

const ARCHIVE = 'the release archive'
const ASSET = 'markdown-office-26.10.7-linux-x86_64.AppImage'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** The network of a release: API answer, SHA256SUMS, archive and bootstrap script. */
function network(o: { sums?: string; archive?: string; script?: string } = {}) {
  return async (url: string, init: { signal: AbortSignal }) => {
    if (url.includes('api.github.com')) return release('26.10.7')
    if (url.endsWith('/SHA256SUMS'))
      return new Response(o.sums ?? `${sha(ARCHIVE)}  ${ASSET}\n${'0'.repeat(64)}  other.zip\n`)
    if (url.includes('/releases/download/')) {
      const body = o.archive ?? ARCHIVE
      return new Response(new Blob([body]).stream(), {
        headers: { 'content-length': String(body.length) },
        // An aborted download fails like the real one.
        ...(init.signal.aborted ? { status: 499 } : {}),
      })
    }
    return new Response(o.script ?? '#!/usr/bin/env bash\n# Markdown Office bootstrap')
  }
}

async function updater(o: Partial<UpdaterDeps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'mdo-upd-'))
  const spawn = vi.fn()
  const quit = vi.fn()
  const progress = vi.fn()
  const removed: string[] = []
  const written = new Map<string, string>()
  const deps: UpdaterDeps = {
    statePath: join(dir, 'app-update.json'),
    logPath: join(dir, 'update.log'),
    pidPath: join(dir, 'update.pid'),
    version: '26.10.6',
    packaged: true,
    arch: 'x64',
    enabled: () => true,
    fetch: network(),
    location: async () => ({
      platform: 'linux',
      mdoHome: '/s',
      relaunch: ['/s/app/markdown-office'],
    }),
    now: () => 100 * DAY,
    tempDir: async () => '/tmp/mdo-update-x',
    writeFile: async (p, data) => {
      written.set(p, Buffer.from(data).toString('utf8'))
    },
    openFile: async (p) => {
      written.set(p, '')
      return {
        write: async (chunk) => {
          written.set(p, (written.get(p) ?? '') + Buffer.from(chunk).toString('utf8'))
        },
        close: async () => undefined,
      }
    },
    removeFile: async (p) => {
      removed.push(p)
      written.delete(p)
    },
    progress,
    readPid: async () => null,
    isAlive: () => false,
    spawn,
    pid: 4242,
    quit,
    ...o,
  }
  return { u: new AppUpdater(deps), deps, spawn, quit, written, progress, removed }
}

describe('AppUpdater', () => {
  it('finds a newer release and offers the install for a bootstrap install', async () => {
    const { u } = await updater()
    expect(await u.check(false)).toEqual({
      kind: 'available',
      version: '26.10.7',
      url: 'https://github.com/jcmx9/MarkdownOffice/releases/tag/v26.10.7',
      canInstall: true,
    })
  })

  it('reports current, and no install without a bootstrap location', async () => {
    const same = await updater({ version: '26.10.7' })
    expect(await same.u.check(true)).toEqual({ kind: 'current', version: '26.10.7' })
    const manual = await updater({ location: async () => null })
    expect(await manual.u.check(true)).toMatchObject({ kind: 'available', canInstall: false })
  })

  it('automatic: once a day, only when switched on, not for a skipped version', async () => {
    let now = 100 * DAY
    const fetch = vi.fn(async () => release('26.10.7'))
    const { u } = await updater({ fetch, now: () => now })
    expect((await u.check(false)).kind).toBe('available')
    now += DAY / 2
    expect(await u.check(false)).toEqual({ kind: 'skipped' })
    expect(fetch).toHaveBeenCalledTimes(1)
    // Manual ignores the day limit.
    expect((await u.check(true)).kind).toBe('available')
    await u.skip('26.10.7')
    now += DAY
    expect(await u.check(false)).toEqual({ kind: 'skipped' })
    // … but the manual check still shows it.
    expect((await u.check(true)).kind).toBe('available')
    const off = await updater({ enabled: () => false })
    expect(await off.u.check(false)).toEqual({ kind: 'skipped' })
  })

  it('never checks in a dev build', async () => {
    const fetch = vi.fn()
    const { u } = await updater({ version: '26.10.7-dev.0', fetch })
    expect(await u.check(true)).toEqual({ kind: 'unsupported' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('network errors come back as failed', async () => {
    const { u } = await updater({
      fetch: async () => {
        throw new Error('offline')
      },
    })
    expect(await u.check(true)).toEqual({ kind: 'failed', message: 'offline' })
  })

  it('install: only an offered version; script written, pending stored, then quit', async () => {
    const { u, quit, spawn, written, deps } = await updater()
    expect(await u.install('26.10.7')).toBe('Diese Version wurde nicht angeboten.')
    await u.check(true)
    expect(await u.install('26.10.7')).toBeNull()
    expect(quit).toHaveBeenCalledOnce()
    expect(written.get('/tmp/mdo-update-x/bootstrap.sh')).toContain('Markdown Office')
    expect(JSON.parse(await readFile(deps.statePath, 'utf8')).pending).toBe('26.10.7')
    // The helper starts only when the app really ends.
    expect(spawn).not.toHaveBeenCalled()
    u.onWillQuit()
    expect(spawn).toHaveBeenCalledOnce()
    const [command, args, mdoHome] = spawn.mock.calls[0] ?? []
    expect(command).toBe('/bin/sh')
    expect(args).toContain('4242')
    expect(args).toContain('/tmp/mdo-update-x/bootstrap.sh')
    expect(args).toContain(`/tmp/mdo-update-x/${ASSET}`)
    expect(args).toContain('/tmp/mdo-update-x/SHA256SUMS')
    expect(args).toContain(deps.pidPath)
    expect(mdoHome).toBe('/s')
  })

  it('install: the archive is downloaded and checked before the quit, with progress', async () => {
    const { u, quit, written, progress } = await updater()
    await u.check(true)
    expect(await u.install('26.10.7')).toBeNull()
    expect(written.get(`/tmp/mdo-update-x/${ASSET}`)).toBe(ARCHIVE)
    expect(written.get('/tmp/mdo-update-x/SHA256SUMS')).toContain(ASSET)
    expect(progress).toHaveBeenLastCalledWith({
      version: '26.10.7',
      received: ARCHIVE.length,
      total: ARCHIVE.length,
    })
    expect(quit).toHaveBeenCalledOnce()
  })

  it('install: a wrong checksum removes the archive and keeps the app running', async () => {
    const { u, quit, removed, spawn } = await updater({ fetch: network({ archive: 'tampered' }) })
    await u.check(true)
    expect(await u.install('26.10.7')).toMatch(/Prüfsumme des Archivs stimmt nicht/)
    expect(removed).toEqual([`/tmp/mdo-update-x/${ASSET}`])
    expect(quit).not.toHaveBeenCalled()
    u.onWillQuit()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('install: SHA256SUMS without this archive refuses before any download', async () => {
    const fetch = vi.fn(network({ sums: `${'0'.repeat(64)}  other.zip\n` }))
    const { u, quit } = await updater({ fetch })
    await u.check(true)
    expect(await u.install('26.10.7')).toMatch(/keinen Eintrag für markdown-office-26\.10\.7/)
    expect(fetch.mock.calls.some(([url]) => url.endsWith(ASSET))).toBe(false)
    expect(quit).not.toHaveBeenCalled()
  })

  it('install: „Abbrechen“ stops the download and answers with an empty message', async () => {
    let release_: () => void = () => undefined
    const gate = new Promise<void>((r) => {
      release_ = r
    })
    const base = network()
    const { u, quit, removed } = await updater({
      fetch: async (url, init) => {
        if (!url.endsWith(ASSET)) return base(url, init)
        await gate
        if (init.signal.aborted) throw new DOMException('aborted', 'AbortError')
        return base(url, init)
      },
    })
    await u.check(true)
    const pending = u.install('26.10.7')
    await vi.waitFor(() => expect(u.install('26.10.7')).resolves.toMatch(/schon geladen/))
    u.cancelDownload()
    release_()
    expect(await pending).toBe('')
    expect(removed).toEqual([`/tmp/mdo-update-x/${ASSET}`])
    expect(quit).not.toHaveBeenCalled()
  })

  it('installing(): only a pending install with a fresh pid file of a living process', async () => {
    const alive = new Set([77])
    const pid = { pid: 77, ageMs: 1000 }
    let read: { pid: number; ageMs: number } | null = pid
    const { u, deps } = await updater({ readPid: async () => read, isAlive: (p) => alive.has(p) })
    expect(await u.installing()).toBe(false)
    await writeFile(deps.statePath, JSON.stringify({ pending: '26.10.7' }))
    expect(await u.installing()).toBe(true)
    alive.clear()
    expect(await u.installing()).toBe(false)
    alive.add(77)
    read = { pid: 77, ageMs: 60 * 60 * 1000 }
    expect(await u.installing()).toBe(false)
    read = { pid: 4242, ageMs: 1000 }
    expect(await u.installing()).toBe(false)
    read = null
    expect(await u.installing()).toBe(false)
  })

  it('a cancelled quit drops the install', async () => {
    const { u, spawn, deps } = await updater()
    await u.check(true)
    await u.install('26.10.7')
    u.cancelInstall()
    u.onWillQuit()
    expect(spawn).not.toHaveBeenCalled()
    await vi.waitFor(async () =>
      expect(JSON.parse(await readFile(deps.statePath, 'utf8')).pending).toBeNull(),
    )
  })

  it('install refuses a script that is not ours', async () => {
    const { u, quit } = await updater({ fetch: network({ script: '<html>' }) })
    await u.check(true)
    expect(await u.install('26.10.7')).toMatch(/Installationsskript unerwartet/)
    expect(quit).not.toHaveBeenCalled()
  })

  it('install refuses an oversized script', async () => {
    const big = `#!/usr/bin/env bash\n# Markdown Office\n${'x'.repeat(SCRIPT_MAX_BYTES)}`
    const { u } = await updater({ fetch: network({ script: big }) })
    await u.check(true)
    expect(await u.install('26.10.7')).toMatch(/zu groß/)
  })

  it('Windows install also writes the helper script', async () => {
    const winAsset = 'markdown-office-26.10.7-win-x64.zip'
    const { u, written, spawn } = await updater({
      fetch: network({ script: '<#\n Markdown Office', sums: `${sha(ARCHIVE)}  ${winAsset}\n` }),
      location: async () => ({ platform: 'win32', mdoHome: 'C:\\M', relaunch: ['C:\\M\\x.exe'] }),
      tempDir: async () => 'C:\\t',
    })
    await u.check(true)
    expect(await u.install('26.10.7')).toBeNull()
    expect(written.get('C:\\t\\update-helper.ps1')).toContain('Wait-Process')
    expect(written.get(`C:\\t\\${winAsset}`)).toBe(ARCHIVE)
    u.onWillQuit()
    expect(spawn.mock.calls[0]?.[0]).toBe('powershell.exe')
    expect(spawn.mock.calls[0]?.[1]).toContain(`C:\\t\\${winAsset}`)
  })

  it('reports the outcome of the last install once', async () => {
    const { u, deps } = await updater({ version: '26.10.6' })
    await u.check(true)
    await u.install('26.10.7')
    const after = new AppUpdater({ ...deps, version: '26.10.6' })
    expect(await after.outcome()).toEqual({
      kind: 'failed',
      version: '26.10.7',
      log: deps.logPath,
    })
    expect(await after.outcome()).toBeNull()
  })
})
