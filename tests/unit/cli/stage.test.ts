// The export manifest (src/cli/stage.ts): which local files a note may pull into its PDF, resolved
// like build.sh resolves them today, and the sweep of staging folders a killed export left behind.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildManifest,
  expandNotePath,
  frontmatterRefs,
  ManifestError,
  type ManifestOptions,
  manifestOptions,
  removeManifest,
  sweepStaleStages,
  writeManifest,
  yamlStr,
} from '../../../src/cli/stage'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
const EVIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><image href="/etc/passwd"/></svg>'
const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n'
const posix = process.platform !== 'win32'

let root = ''
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'mdo stage test ')))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** Writes `files` (relative path -> content) under root, folders created. */
function tree(files: Record<string, string | Buffer>): void {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
}
const at = (rel: string) => path.join(root, rel)
const opts = (o: Partial<ManifestOptions> = {}): ManifestOptions => ({
  templatesDir: at('user'),
  setsDir: at('sets'),
  pipelineRoot: at('pipeline'),
  cwd: root,
  env: { HOME: at('home') },
  win: false,
  ...o,
})

describe.runIf(posix)('buildManifest (the brief case)', () => {
  it('lists exactly the legit images, the outside image, the profile YAML and its own signature', async () => {
    tree({
      'notes/a.png': PNG,
      'notes/id_rsa': KEY,
      'notes/evil.svg': EVIL_SVG,
      'outside/b.png': PNG,
      'user/profiles/kanzlei.yaml': 'name: Kanzlei\nsignature: kanzlei-sig.svg\nlogo: ../b.png\n',
      'user/profiles/kanzlei-sig.svg': SVG,
      'user/profiles/other.yaml': 'name: Other\nsignature: other-sig.svg\n',
      'user/profiles/other-sig.svg': SVG,
      'sets/din5008a/din5008a.typ': '// set\n',
      'notes/n.md': [
        '---',
        'template: din5008a',
        'profile: kanzlei',
        '---',
        '![a](a.png) ![b](../outside/b.png) ![k](id_rsa) ![k2](key.png) ![e](evil.svg)',
        '![m](missing.png) ![r](https://example.org/r.png)',
        '',
      ].join('\n'),
    })
    // A key file renamed by a link: the extension says PNG, the bytes do not.
    symlinkSync(at('notes/id_rsa'), at('notes/key.png'))

    const { manifest, hints } = await buildManifest(at('notes/n.md'), opts())

    expect(manifest).toEqual({
      note: at('notes/n.md'),
      images: [
        { ref: 'a.png', path: at('notes/a.png') },
        { ref: '../outside/b.png', path: at('outside/b.png') },
      ],
      logo: null,
      profile: {
        yaml: at('user/profiles/kanzlei.yaml'),
        files: [at('user/profiles/kanzlei-sig.svg')],
      },
    })
    expect(hints.join('\n')).toContain('id_rsa')
    expect(hints.join('\n')).toContain('key.png')
    expect(hints.join('\n')).toContain('evil.svg')
  })
})

describe.runIf(posix)('buildManifest images', () => {
  it('expands ~, $VAR and %XX in a destination like expand_path, keyed by the note spelling', async () => {
    tree({ 'home/pics/h.png': PNG, 'notes/a b.png': PNG, 'notes/n.md': '' })
    writeFileSync(at('notes/n.md'), '![](~/pics/h.png) ![]($HOME/pics/h.png) ![](a%20b.png)\n')
    const { manifest } = await buildManifest(at('notes/n.md'), opts())
    expect(manifest.images).toEqual([
      { ref: '~/pics/h.png', path: at('home/pics/h.png') },
      { ref: '$HOME/pics/h.png', path: at('home/pics/h.png') },
      { ref: 'a%20b.png', path: at('notes/a b.png') },
    ])
  })

  it('resolves relative images against MDO_BASE_DIR when given', async () => {
    tree({ 'orig/a.png': PNG, 'tmp/n.md': '![](a.png)\n' })
    const { manifest } = await buildManifest(at('tmp/n.md'), opts({ baseDir: at('orig') }))
    expect(manifest.images).toEqual([{ ref: 'a.png', path: at('orig/a.png') }])
  })

  it('a base dir that is no folder falls back to the note folder (the script warns)', async () => {
    tree({ 'tmp/a.png': PNG, 'tmp/n.md': '![](a.png)\n' })
    const { manifest } = await buildManifest(at('tmp/n.md'), opts({ baseDir: at('nope') }))
    expect(manifest.images).toEqual([{ ref: 'a.png', path: at('tmp/a.png') }])
  })

  it('keeps a symlinked image whose target is a real image, under the linked name', async () => {
    tree({ 'store/real.png': PNG, 'notes/n.md': '![](l.png)\n' })
    symlinkSync(at('store/real.png'), at('notes/l.png'))
    const { manifest } = await buildManifest(at('notes/n.md'), opts())
    expect(manifest.images).toEqual([{ ref: 'l.png', path: at('notes/l.png') }])
  })

  it('never lists a folder, even one named like an image', async () => {
    tree({ 'notes/d.png/x': 'x', 'notes/n.md': '![](d.png)\n' })
    const { manifest } = await buildManifest(at('notes/n.md'), opts())
    expect(manifest.images).toEqual([])
  })
})

describe.runIf(posix)('buildManifest logo', () => {
  const note = (logo: string) => tree({ 'notes/n.md': `---\nlogo: ${logo}\n---\nText\n` })

  it('searches the note folder, then HOME, then the templates folder, then the pipeline', async () => {
    tree({ 'pipeline/l.svg': SVG, 'user/l.svg': SVG, 'home/l.svg': SVG })
    note('l.svg')
    expect((await buildManifest(at('notes/n.md'), opts())).manifest.logo).toBe(at('home/l.svg'))
    rmSync(at('home/l.svg'))
    expect((await buildManifest(at('notes/n.md'), opts())).manifest.logo).toBe(at('user/l.svg'))
    rmSync(at('user/l.svg'))
    expect((await buildManifest(at('notes/n.md'), opts())).manifest.logo).toBe(at('pipeline/l.svg'))
    tree({ 'notes/l.svg': SVG })
    expect((await buildManifest(at('notes/n.md'), opts())).manifest.logo).toBe(at('notes/l.svg'))
  })

  it('reads no header behind a BOM, as build.sh does', async () => {
    tree({ 'notes/l.svg': SVG, 'notes/n.md': '\uFEFF---\nlogo: l.svg\n---\n' })
    expect((await buildManifest(at('notes/n.md'), opts())).manifest.logo).toBeNull()
  })

  it('takes an absolute or ~ path as exactly that file', async () => {
    tree({ 'home/logos/x.png': PNG })
    note('~/logos/x.png')
    expect((await buildManifest(at('notes/n.md'), opts())).manifest.logo).toBe(
      at('home/logos/x.png'),
    )
  })

  it('drops a logo that is no real image, a remote one and a wrong extension', async () => {
    tree({ 'notes/fake.png': KEY, 'notes/g.gif': Buffer.from('GIF89a') })
    note('fake.png')
    const r = await buildManifest(at('notes/n.md'), opts())
    expect(r.manifest.logo).toBeNull()
    expect(r.hints.join('\n')).toContain('fake.png')
    note('https://example.org/l.png')
    expect((await buildManifest(at('notes/n.md'), opts())).manifest.logo).toBeNull()
    note('g.gif')
    expect((await buildManifest(at('notes/n.md'), opts())).manifest.logo).toBeNull()
  })
})

describe.runIf(posix)('buildManifest profile', () => {
  const note = (fm: string) => tree({ 'notes/n.md': `---\n${fm}\n---\nText\n` })

  it('looks a name up in the note folder, <templates>/<set>, <templates>, then the set', async () => {
    tree({
      'sets/memo/memo.typ': '',
      'sets/memo/profiles/p.yaml': 'n: set\n',
      'user/profiles/p.yaml': 'n: shared\n',
      'user/memo/profiles/p.yaml': 'n: user set\n',
      'notes/profiles/p.yaml': 'n: note\n',
    })
    note('profile: p')
    const yaml = async () => (await buildManifest(at('notes/n.md'), opts())).manifest.profile?.yaml
    expect(await yaml()).toBe(at('notes/profiles/p.yaml'))
    rmSync(at('notes/profiles/p.yaml'))
    expect(await yaml()).toBe(at('user/memo/profiles/p.yaml'))
    rmSync(at('user/memo/profiles/p.yaml'))
    expect(await yaml()).toBe(at('user/profiles/p.yaml'))
    rmSync(at('user/profiles/p.yaml'))
    expect(await yaml()).toBe(at('sets/memo/profiles/p.yaml'))
  })

  it('--template wins over the header for the set folder', async () => {
    tree({
      'sets/memo/memo.typ': '',
      'sets/din5008a/din5008a.typ': '',
      'sets/din5008a/profiles/p.yaml': 'n: din\n',
    })
    note('profile: p')
    const r = await buildManifest(at('notes/n.md'), opts({ template: 'din5008a' }))
    expect(r.manifest.profile?.yaml).toBe(at('sets/din5008a/profiles/p.yaml'))
  })

  it('takes a .yaml path relative to the note folder, with ~ and $VAR', async () => {
    tree({
      'sets/memo/memo.typ': '',
      'notes/sub/a.yaml': 'n: a\nsig: s.png\n',
      'notes/sub/s.png': PNG,
      'home/b.yml': 'x: 1\n',
    })
    note('profile: sub/a.yaml')
    expect((await buildManifest(at('notes/n.md'), opts())).manifest.profile).toEqual({
      yaml: at('notes/sub/a.yaml'),
      files: [at('notes/sub/s.png')],
    })
    note('profile: $HOME/b.yml')
    expect((await buildManifest(at('notes/n.md'), opts())).manifest.profile?.yaml).toBe(
      at('home/b.yml'),
    )
  })

  it('names only image files that exist next to the profile and are real images', async () => {
    tree({
      'sets/memo/memo.typ': '',
      'user/profiles/p.yaml': 'a: ok.svg\nb: fake.png\nc: gone.png\nd: ../up.png\ne: evil.svg\n',
      'user/profiles/ok.svg': SVG,
      'user/profiles/fake.png': KEY,
      'user/profiles/evil.svg': EVIL_SVG,
      'user/up.png': PNG,
    })
    note('profile: p')
    const r = await buildManifest(at('notes/n.md'), opts())
    expect(r.manifest.profile?.files).toEqual([at('user/profiles/ok.svg')])
  })

  it('fails like the script when a profile is not found or invalid', async () => {
    tree({ 'sets/memo/memo.typ': '' })
    note('profile: nope')
    await expect(buildManifest(at('notes/n.md'), opts())).rejects.toThrow(ManifestError)
    await expect(buildManifest(at('notes/n.md'), opts())).rejects.toThrow(
      `Profil nicht gefunden: nope (gesucht in ${at('notes/profiles')}, ${at('user/memo/profiles')}, ${at('user/profiles')}, ${at('sets/memo/profiles')})`,
    )
    note('profile: x.yaml')
    await expect(buildManifest(at('notes/n.md'), opts())).rejects.toThrow(
      'Profil nicht gefunden: x.yaml',
    )
    note('profile: Bad Name')
    await expect(buildManifest(at('notes/n.md'), opts())).rejects.toThrow('ungültiges Profil')
  })

  it('leaves the error to the script when the set itself cannot be found', async () => {
    note('template: nosuchset\nprofile: p')
    const r = await buildManifest(at('notes/n.md'), opts())
    expect(r.manifest.profile).toBeNull()
  })
})

describe('frontmatterRefs / yamlStr', () => {
  it('reads logo, profile and template like build.sh (last wins, CRLF, comments, quotes)', () => {
    const text =
      '---\r\nlogo: a.png # c\r\nlogo-height: 2cm\r\nprofile: "p q"\r\ntemplate: x\r\ntemplate: memo\r\n...\r\nlogo: no.png\r\n'
    expect(frontmatterRefs(text, false)).toEqual({
      logo: 'a.png',
      profile: 'p q',
      template: 'memo',
    })
  })

  it('ignores indented keys and a BOM-led header on macOS/Linux, not on Windows', () => {
    expect(frontmatterRefs('---\n  logo: a.png\n---\n', false).logo).toBe('')
    expect(frontmatterRefs('\uFEFF---\nlogo: a.png\n---\n', false).logo).toBe('')
    expect(frontmatterRefs('\uFEFF---\nlogo: a.png\n---\n', true).logo).toBe('a.png')
  })

  it('cleans scalars like yaml_str', () => {
    expect(yamlStr('  "a # b" tail')).toBe('a # b')
    expect(yamlStr(" 'x")).toBe('x')
    expect(yamlStr(' [a, "b"]')).toBe('a, b')
    expect(yamlStr(' v #c ')).toBe('v')
    expect(yamlStr(' v#c ')).toBe('v#c')
  })
})

describe('expandNotePath', () => {
  const env = { HOME: '/h', USERPROFILE: 'C:\\Users\\u', A: 'x', NESTED: '$A' }

  // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal ${VAR} as a note writes it
  it('macOS/Linux: ~, ${VAR}, $VAR, %VAR%, %XX (bytes, repeated) and backslashes', () => {
    expect(expandNotePath('~/p', env, false)).toBe('/h/p')
    expect(expandNotePath('~', env, false)).toBe('/h')
    expect(expandNotePath('a~/p', env, false)).toBe('a~/p')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal ${VAR} as a note writes it
    expect(expandNotePath('${A}/$A/%A%', env, false)).toBe('x/x/x')
    expect(expandNotePath('$NESTED', env, false)).toBe('x')
    expect(expandNotePath('$UNSET/y', env, false)).toBe('/y')
    expect(expandNotePath('a%20b', env, false)).toBe('a b')
    // %VAR% runs first, so `%C3%` is read as a variable, as build.sh does.
    expect(expandNotePath('%C3%A4', env, false)).toBe('A4')
    expect(expandNotePath('%2541', env, false)).toBe('A')
    expect(expandNotePath('a\\b', env, false)).toBe('a/b')
    expect(expandNotePath('~/p', { USERPROFILE: '/up' }, false)).toBe('/up/p')
  })

  it('Windows: one pass per form, %XX as one character, backslashes kept', () => {
    expect(expandNotePath('~\\p', env, true)).toBe('/h\\p')
    expect(expandNotePath('~\\p', { USERPROFILE: 'C:\\Users\\u' }, true)).toBe('C:\\Users\\u\\p')
    // Regex.Replace never rescans its own replacement.
    expect(expandNotePath('$NESTED', env, true)).toBe('$A')
    expect(expandNotePath('%20%7E\\x', env, true)).toBe(' ~\\x')
    expect(expandNotePath('%2541', env, true)).toBe('%41')
    expect(expandNotePath('%a%', { a: 'v' }, true)).toBe('v')
  })
})

describe.runIf(posix)('writeManifest / removeManifest', () => {
  it('writes the JSON into a fresh private folder with the stage marker, removed afterwards', async () => {
    tree({ 'notes/a.png': PNG, 'notes/n.md': '![](a.png)\n' })
    const file = await writeManifest(at('notes/n.md'), opts({ tmpDir: at('tmp') }))
    const dir = path.dirname(file)
    expect(path.basename(dir)).toMatch(/^mdo-stage-/)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(existsSync(path.join(dir, '.mdo-stage'))).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      note: at('notes/n.md'),
      images: [{ ref: 'a.png', path: at('notes/a.png') }],
      logo: null,
      profile: null,
    })
    await removeManifest(file)
    expect(existsSync(dir)).toBe(false)
  })
})

describe.runIf(posix)('sweepStaleStages', () => {
  const HOUR = 3600_000
  const now = Date.now()
  const stage = (name: string, ageMs: number | null) => {
    const dir = at(`tmp/${name}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'note.md'), 'x')
    if (ageMs !== null) {
      const marker = path.join(dir, '.mdo-stage')
      writeFileSync(marker, '')
      const t = (now - ageMs) / 1000
      utimesSync(marker, t, t)
    }
    return dir
  }

  it('removes an old marked stage, keeps a fresh one, an unmarked one and other names', async () => {
    const old = stage('mdo-stage-old', 2 * HOUR)
    const fresh = stage('mdo-stage-fresh', 10 * 60_000)
    const unmarked = stage('mdo-stage-plain', null)
    const other = stage('something-else', 2 * HOUR)
    await sweepStaleStages(at('tmp'), now)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(unmarked)).toBe(true)
    expect(existsSync(other)).toBe(true)
  })

  it('never follows a symlink named like a stage, nor one inside a stage', async () => {
    const victim = stage('victim', 2 * HOUR)
    symlinkSync(victim, at('tmp/mdo-stage-link'))
    const old = stage('mdo-stage-old', 2 * HOUR)
    const keep = at('keep.txt')
    writeFileSync(keep, 'k')
    symlinkSync(keep, path.join(old, 'link'))
    await sweepStaleStages(at('tmp'), now)
    expect(existsSync(path.join(victim, 'note.md'))).toBe(true)
    expect(lstatSync(at('tmp/mdo-stage-link')).isSymbolicLink()).toBe(true)
    expect(existsSync(old)).toBe(false)
    expect(readFileSync(keep, 'utf8')).toBe('k')
  })

  it('ignores a marker that is a symlink or a folder, and a missing temp folder', async () => {
    const dir = stage('mdo-stage-fake', null)
    symlinkSync(at('keep'), path.join(dir, '.mdo-stage'))
    await sweepStaleStages(at('tmp'), now + 10 * HOUR)
    expect(existsSync(dir)).toBe(true)
    await expect(sweepStaleStages(at('nope'), now)).resolves.toBeUndefined()
  })
})

describe('manifestOptions', () => {
  it('macOS/Linux: MDO_TEMPLATES (relative to the caller) or $HOME/Documents/…', () => {
    const env = { HOME: '/h', MDO_SETS_DIR: '/s', MDO_PIPELINE_ROOT: '/p', MDO_BASE_DIR: 'b' }
    expect(manifestOptions('darwin', env, '/cwd', 'memo')).toEqual({
      templatesDir: '/h/Documents/Markdown Office/Vorlagen',
      setsDir: '/s',
      pipelineRoot: '/p',
      baseDir: 'b',
      template: 'memo',
      cwd: '/cwd',
      env,
      win: false,
    })
    expect(
      manifestOptions('linux', { ...env, MDO_TEMPLATES: 'tpl' }, '/cwd', '').templatesDir,
    ).toBe('/cwd/tpl')
  })

  it('Windows: MDO_TEMPLATES or USERPROFILE\\Documents\\…', () => {
    const env = { USERPROFILE: 'C:\\Users\\u', MDO_SETS_DIR: 'C:\\s', MDO_PIPELINE_ROOT: 'C:\\p' }
    const o = manifestOptions('win32', env, 'C:\\cwd', '')
    expect(o.templatesDir).toBe('C:\\Users\\u\\Documents\\Markdown Office\\Vorlagen')
    expect(o.win).toBe(true)
  })
})
