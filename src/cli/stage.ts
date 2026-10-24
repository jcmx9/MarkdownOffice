// The export manifest: the local files one note may pull into its PDF, handed to build.sh /
// convert.ps1 as MDO_MANIFEST=<file>. The scripts copy exactly these (plus the set and the
// pipeline's own lib/vendor parts) into a staging folder that is Typst's root, so note text
// (raw-typst comments, mitex passthroughs) can reach nothing else.
//
// Why here and not in the scripts: which files are legitimate is decided once, in TypeScript,
// with the editor's Markdown parser (core/export-files) instead of the probe pass, which runs
// note-controlled Typst and could name any path. The manifest carries the images, the logo and
// the profile, so this file is the single source of truth for all three; the scripts take logo
// and profile from it and keep only the set lookup (the set folder is trusted, the user chose it).
//
// The lookups below mirror build.sh / convert.ps1 as they were before the staging root (logo
// search order, profile lookup order, `~`/$VAR/%XX expansion, MDO_BASE_DIR), so a note whose
// files were found before still finds the same files. Where the two scripts differ, `win`
// selects convert.ps1's behaviour (noted at each place).
import { constants, type Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  imageKind,
  profileImageNames,
  svgHasExternalRefs,
  visibleImages,
} from '../core/export-files'
import type { Env } from './launch'

/** What MDO_MANIFEST points to (JSON). Every path is absolute and was validated. */
export interface Manifest {
  /** The note, absolute (as the scripts resolve the argument). */
  note: string
  /** `ref` = the destination as written in the note (the probe's spelling, the image map key). */
  images: { ref: string; path: string }[]
  logo: string | null
  /** The profile YAML and the image files next to it whose names the YAML holds as values. */
  profile: { yaml: string; files: string[] } | null
}

/** A failure the scripts reported before (profile not found …): message only, exit 1. */
export class ManifestError extends Error {}

export interface ManifestOptions {
  /** The user's templates folder, resolved like the scripts do (see manifestOptions). */
  templatesDir: string
  setsDir: string
  /** `--template` from the command line; wins over the header's `template:`. */
  template?: string
  /** The caller's working folder (relative --template .typ, MDO_BASE_DIR). */
  cwd?: string
  /** MDO_BASE_DIR as given: relative images, logo and profile resolve against it. */
  baseDir?: string
  /** The pipeline folder: the last logo search place. */
  pipelineRoot?: string
  /** The environment for `~` and $VAR in note paths. */
  env?: Env
  /** convert.ps1's rules instead of build.sh's. */
  win?: boolean
  /** Where the manifest folder is created (default: the system temp folder of the caller). */
  tmpDir?: string
}

/** Marker of a staging folder; only folders carrying it are ever swept. */
export const STAGE_MARKER = '.mdo-stage'
const STAGE_PREFIX = 'mdo-stage-'
const STALE_MS = 3600_000
// Large enough for an SVG's head; the bitmap formats are decided by their first bytes.
const HEAD_BYTES = 65536
// O_NONBLOCK: opening a FIFO named like an image must not hang the export.
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)
const NAME_RE = /^[a-z0-9_-]+$/
const SPACE = '[ \\t\\n\\v\\f\\r]'

// ---------------------------------------------------------------------------------------------
// Front matter, as the scripts read it (line by line, not as YAML): only the three keys that
// name files matter here.
// ---------------------------------------------------------------------------------------------

/** build.sh yaml_str (convert.ps1 ConvertTo-YamlStr): a scalar without quotes and comment. */
export function yamlStr(raw: string): string {
  const v = raw.replace(new RegExp(`^${SPACE}+|${SPACE}+$`, 'g'), '')
  const q = v[0]
  if (q === '"' || q === "'") {
    const rest = v.slice(1)
    const end = rest.indexOf(q)
    return end < 0 ? rest : rest.slice(0, end)
  }
  if (q === '[') {
    const rest = v.slice(1)
    const end = rest.indexOf(']')
    return (end < 0 ? rest : rest.slice(0, end))
      .replace(/["']/g, '')
      .replace(new RegExp(`${SPACE}*,${SPACE}*`, 'g'), ', ')
      .replace(new RegExp(`^${SPACE}+|${SPACE}+$`, 'g'), '')
  }
  return v.replace(new RegExp(`${SPACE}#.*$`), '').replace(new RegExp(`${SPACE}+$`), '')
}

/**
 * `logo:`, `profile:` and `template:` of the header ('' when absent; the last one wins). build.sh
 * needs `---` as the very first line (a BOM hides the header there; convert.ps1 reads with BOM
 * removal and trims the delimiter lines) and reads up to a `---`/`...` line or the end.
 */
export function frontmatterRefs(
  text: string,
  win: boolean,
): { logo: string; profile: string; template: string } {
  const out = { logo: '', profile: '', template: '' }
  const lines = (win ? text.replace(/^\uFEFF/, '') : text).split(win ? /\r\n|\n|\r/ : '\n')
  const first = lines[0] ?? ''
  if ((win ? first.trim() : first.replace(/\r/g, '')) !== '---') return out
  for (const raw of lines.slice(1)) {
    if (win ? ['---', '...'].includes(raw.trim()) : /^(---|\.\.\.)\s*$/.test(raw)) break
    const line = raw.replace(/\r/g, '')
    for (const key of ['logo', 'profile', 'template'] as const) {
      if (line.startsWith(`${key}:`)) out[key] = yamlStr(line.slice(key.length + 1))
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Note paths: build.sh expand_path / convert.ps1 Expand-NotePath.
// ---------------------------------------------------------------------------------------------

const FALLBACK: Record<string, string> = {
  USER: 'USERNAME',
  USERNAME: 'USER',
  HOME: 'USERPROFILE',
  USERPROFILE: 'HOME',
}

/** env_lookup / Get-EnvFallback: USER<->USERNAME, HOME<->USERPROFILE when empty. */
function envLookup(env: Env, name: string, win: boolean): string {
  const get = (n: string) => {
    if (!win) return env[n] ?? ''
    // Windows names are case-insensitive.
    const key = Object.keys(env).find((k) => k.toUpperCase() === n.toUpperCase())
    return key === undefined ? '' : (env[key] ?? '')
  }
  let v = get(name)
  const alt = FALLBACK[win ? name.toUpperCase() : name]
  if (!v && alt) v = get(alt)
  // Command substitution in build.sh drops trailing newlines.
  return win ? v : v.replace(/\n+$/, '')
}

// build.sh works on bytes: a %XX sequence is one byte, several of them form one UTF-8 character.
const toBytes = (s: string) => Buffer.from(s, 'utf8').toString('latin1')
const fromBytes = (s: string) => Buffer.from(s, 'latin1').toString('utf8')

/**
 * `~`, `${VAR}`, `$VAR`, `%VAR%` and `%XX` in a path from a note, nothing executed. build.sh
 * repeats each form until none is left (bounded like its guard: 20/40/60/200 replacements in
 * all), so a value or a decoded byte that forms a new one is expanded too, and turns backslashes
 * into `/`. convert.ps1 replaces each form once over the whole string, decodes %XX to one
 * character (so UTF-8 sequences become one character per byte) and keeps backslashes.
 */
export function expandNotePath(p: string, env: Env, win: boolean): string {
  let s = p
  if (s === '~' || /^~[\\/]/.test(s)) s = envLookup(env, 'HOME', win) + s.slice(1)
  if (win) {
    const look = (_: string, name: string) => envLookup(env, name, true)
    return s
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, look)
      .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, look)
      .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, look)
      .replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      )
  }
  s = toBytes(s)
  let guard = 0
  const loop = (re: RegExp, limit: number, value: (m: RegExpExecArray) => string) => {
    for (let m = re.exec(s); m; m = re.exec(s)) {
      if (!(guard++ < limit)) break
      // Each replacement goes through $(…), which drops trailing newlines.
      s = (s.slice(0, m.index) + value(m) + s.slice(m.index + m[0].length)).replace(/\n+$/, '')
    }
  }
  const look = (m: RegExpExecArray) => toBytes(envLookup(env, m[1] as string, false))
  loop(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/, 20, look)
  loop(/\$([A-Za-z_][A-Za-z0-9_]*)/, 40, look)
  loop(/%([A-Za-z_][A-Za-z0-9_]*)%/, 60, look)
  loop(/%([0-9A-Fa-f]{2})/, 200, (m) => {
    // printf "\xHH" inside $(…): a NUL byte or a trailing newline does not survive.
    const c = String.fromCharCode(Number.parseInt(m[1] as string, 16))
    return c === '\0' || c === '\n' ? '' : c
  })
  return fromBytes(s.replace(/\\/g, '/')).replace(/\n+$/, '')
}

// ---------------------------------------------------------------------------------------------
// File checks.
// ---------------------------------------------------------------------------------------------

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/**
 * True if `p` (symlinks followed: the target's content is what gets staged) is a regular file
 * whose extension and content agree on an image type, and, for an SVG, references nothing
 * outside itself.
 */
async function isSafeImage(p: string): Promise<boolean> {
  let fh: fs.FileHandle | undefined
  try {
    if (!(await fs.stat(p)).isFile()) return false
    fh = await fs.open(p, OPEN_FLAGS)
    const st = await fh.stat()
    if (!st.isFile()) return false
    const head = Buffer.alloc(Math.min(HEAD_BYTES, st.size))
    await fh.read(head, 0, head.length, 0)
    const kind = imageKind(head, path.basename(p))
    if (kind !== 'svg') return kind !== null
    // An SVG is checked whole: a reference can sit anywhere in it.
    const all = st.size <= head.length ? head : await fh.readFile()
    return !svgHasExternalRefs(all.toString('utf8'))
  } catch {
    return false
  } finally {
    await fh?.close()
  }
}

// ---------------------------------------------------------------------------------------------
// The manifest.
// ---------------------------------------------------------------------------------------------

interface Ctx {
  P: typeof path.posix
  win: boolean
  noteDir: string
  env: Env
  cwd: string
  baseDir: string
  templatesDir: string
  setsDir: string
  pipelineRoot: string
}

/** build.sh `case /*` / convert.ps1 IsPathRooted (`\x` and `C:x` count as rooted there). */
const rooted = (c: Ctx, p: string) => (c.win ? /^([A-Za-z]:|[\\/])/.test(p) : p.startsWith('/'))
/** A note path against a folder: rooted paths stay ([IO.Path]::Combine semantics). */
const against = (c: Ctx, dir: string, p: string) => c.P.resolve(rooted(c, p) ? p : c.P.join(dir, p))
/**
 * Windows: a UNC or device path (`\\server\x`, `//server/x`, `\\?\…`, `\\.\…`) from note
 * text. Refused before any file system call: merely looking one up makes Windows contact the
 * server over SMB, which can leak the user's NTLM hash to whoever the note names.
 */
export const remoteWinPath = (p: string, win: boolean) => win && /^[\\/]{2}/.test(p)
const uncPath = (c: Ctx, p: string) => remoteWinPath(p, c.win)

/**
 * resolve_template / Resolve-Template, reduced to the file it finds (null: the script fails).
 * `fromNote`: the value comes from the note's `template:` (not the user's --template). Such a
 * .typ path is staged and run with the note, so it must be a plain file (not a symlink) ending
 * in .typ (link count 1) whose real path lies under the note's folder (or MDO_BASE_DIR) or the templates folder,
 * with no dot segment below either; else ManifestError. Why: `template: ./evil.typ` linked to
 * ~/.ssh/… or `template: ~/.config/x/x.typ` would put any local file into the staging root and
 * into the PDF. build.sh / convert.ps1 re-check the same rule and stage only that one file.
 */
async function templateFile(
  c: Ctx,
  value: string,
  base: string,
  fromNote: boolean,
): Promise<string | null> {
  const v = value || 'memo'
  if (NAME_RE.test(v)) {
    const user = c.templatesDir
      ? [c.P.join(c.templatesDir, `${v}.typ`), c.P.join(c.templatesDir, v, `${v}.typ`)]
      : []
    for (const p of [...user, c.P.join(c.setsDir, v, `${v}.typ`)]) {
      if (await isFile(p)) return p
    }
    return null
  }
  if (!v.toLowerCase().endsWith('.typ')) return null
  const e = expandNotePath(v, c.env, c.win)
  if (uncPath(c, e)) return null
  const p = against(c, base, e)
  if (!(await isFile(p))) return null
  if (fromNote && !(await noteTemplateAllowed(c, p))) {
    throw new ManifestError(
      `Vorlage muss eine .typ-Datei im Ordner der Notiz oder im Vorlagen-Ordner sein: ${value}`,
    )
  }
  return p
}

/** The rule for a note-named .typ path (see templateFile). */
async function noteTemplateAllowed(c: Ctx, p: string): Promise<boolean> {
  try {
    // No symlink, and no hard link either: a second name of the same file can be a foreign file.
    const st = await fs.lstat(p)
    if (st.isSymbolicLink() || st.nlink > 1) return false
  } catch {
    return false
  }
  const real = await realOrNull(p)
  if (real === null || !real.toLowerCase().endsWith('.typ')) return false
  for (const root of [c.noteDir, c.baseDir, c.templatesDir]) {
    if (await realUnder(c, p, root, true)) return true
  }
  return false
}

/** The logo the header names, as the scripts search it; null with a hint when not usable. */
async function findLogo(c: Ctx, value: string, hints: string[]): Promise<string | null> {
  if (!value) return null
  // Remote and non-image values: the scripts print their own hint and build without a logo.
  if (/^(https?:)?\/\/|^data:/i.test(value) || !/\.(svg|png|jpe?g)$/i.test(value)) return null
  const p = expandNotePath(value, c.env, c.win)
  // Treated as not found (the script's hint follows).
  if (uncPath(c, p)) return null
  let found: string | null = null
  if (rooted(c, p)) {
    if (await isFile(p)) found = c.P.resolve(p)
  } else {
    // build.sh takes $HOME as is; convert.ps1 USERPROFILE with the HOME fallback.
    const home = c.win ? envLookup(c.env, 'USERPROFILE', true) : (c.env.HOME ?? '')
    for (const dir of [c.baseDir, home, c.templatesDir, c.pipelineRoot]) {
      if (dir && (await isFile(c.P.join(dir, p)))) {
        found = c.P.resolve(dir, p)
        break
      }
    }
  }
  if (found === null) return null
  if (await isSafeImage(found)) return found
  hints.push(`Hinweis: Logo ist kein gültiges Bild und kommt nicht ins PDF: ${value}`)
  return null
}

/**
 * The options for writeManifest from the wrapper's environment (after invocation() filled in
 * MDO_PIPELINE_ROOT and MDO_SETS_DIR, and windowsTemplates() MDO_TEMPLATES on Windows). The
 * templates folder as the scripts derive it: MDO_TEMPLATES (relative to the caller's folder),
 * else build.sh's `$HOME/Documents/Markdown Office/Vorlagen`. On Windows without MDO_TEMPLATES
 * (no Documents folder, see windowsTemplates) there is none, as in convert.ps1.
 */
export function manifestOptions(
  platform: string,
  env: Env,
  cwd: string,
  template: string,
): ManifestOptions {
  const win = platform === 'win32'
  const P = win ? path.win32 : path.posix
  // build.sh writes `${HOME:-}/Documents/…`: an empty HOME gives /Documents/…, not a relative path.
  const fallback = win ? '' : `${env.HOME ?? ''}/Documents/Markdown Office/Vorlagen`
  const templates = env.MDO_TEMPLATES || fallback
  return {
    templatesDir: templates ? P.resolve(cwd, templates) : '',
    setsDir: P.resolve(cwd, env.MDO_SETS_DIR ?? ''),
    pipelineRoot: P.resolve(cwd, env.MDO_PIPELINE_ROOT ?? ''),
    baseDir: env.MDO_BASE_DIR || undefined,
    template,
    cwd,
    env,
    win,
  }
}

/** Runs a program without a shell and resolves with its stdout (rejects on failure). */
export type Runner = (file: string, args: string[], timeoutMs: number) => Promise<string>

/**
 * Windows: the environment with MDO_TEMPLATES set to the folder convert.ps1 would use, so the
 * wrapper and the script agree. convert.ps1 takes `[Environment]::GetFolderPath('MyDocuments')`,
 * which OneDrive can redirect and Node cannot ask for; so the wrapper asks PowerShell once
 * (no profile, short timeout). On failure `%USERPROFILE%\Documents` stands in (then passed to
 * the script too). An empty answer (no Documents folder, service accounts) means no user
 * templates for both: MDO_TEMPLATES stays unset and convert.ps1 gets '' itself. An existing
 * MDO_TEMPLATES is kept.
 */
export async function windowsTemplates(env: Env, powershell: string, run: Runner): Promise<Env> {
  if (envLookup(env, 'MDO_TEMPLATES', true)) return env
  let docs: string
  try {
    docs = (
      await run(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          // Base64 of the UTF-8 bytes: Windows PowerShell writes stdout in the OEM code page, so a
          // Documents path with ü/ß would arrive mangled; ASCII output survives any code page.
          "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([Environment]::GetFolderPath('MyDocuments')))",
        ],
        5000,
      )
    ).trim()
    docs = Buffer.from(docs, 'base64').toString('utf8')
  } catch {
    const home = envLookup(env, 'USERPROFILE', true)
    docs = home ? path.win32.join(home, 'Documents') : ''
  }
  if (!docs) return env
  return { ...env, MDO_TEMPLATES: path.win32.join(docs, 'Markdown Office', 'Vorlagen') }
}

/**
 * The manifest of one note: its visible local images, its logo and its profile, each validated.
 * Rejected files are left out (the PDF shows them as missing) with a hint for the user.
 */
export async function buildManifest(
  notePath: string,
  opts: ManifestOptions,
): Promise<{ manifest: Manifest; hints: string[] }> {
  const win = opts.win ?? process.platform === 'win32'
  const P = win ? path.win32 : path.posix
  const cwd = opts.cwd ?? process.cwd()
  const env = opts.env ?? process.env
  const note = P.resolve(cwd, notePath)
  let baseDir = P.dirname(note)
  // MDO_BASE_DIR: relative to the caller's folder; not a folder -> the note's (the script warns).
  if (opts.baseDir) {
    const b = P.resolve(cwd, opts.baseDir)
    if (await isDir(b)) baseDir = b
  }
  const c: Ctx = {
    P,
    win,
    noteDir: P.dirname(note),
    env,
    cwd,
    baseDir,
    // '' = no user templates folder (Windows without a Documents folder, as convert.ps1).
    templatesDir: opts.templatesDir ? P.resolve(cwd, opts.templatesDir) : '',
    setsDir: P.resolve(cwd, opts.setsDir),
    pipelineRoot: opts.pipelineRoot ? P.resolve(cwd, opts.pipelineRoot) : '',
  }
  // ignoreBOM keeps a BOM in the text: it hides the header from build.sh (see frontmatterRefs).
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await fs.readFile(note))
  const hints: string[] = []

  const images: Manifest['images'] = []
  for (const ref of visibleImages(text.replace(/^\uFEFF/, ''))) {
    // Remote sources: the sets skip them (and count them for the hint), nothing to stage.
    if (/^(https?:)?\/\/|^data:/i.test(ref)) continue
    const e = expandNotePath(ref, env, win)
    // A UNC/device path counts as missing (see uncPath).
    if (uncPath(c, e)) continue
    const p = against(c, baseDir, e)
    // Missing: the script warns „Bild nicht gefunden“ for a probe source without an entry.
    if (!(await isFile(p))) continue
    if (await isSafeImage(p)) images.push({ ref, path: p })
    else hints.push(`Hinweis: kein gültiges Bild, kommt nicht ins PDF: ${ref}`)
  }

  const fm = frontmatterRefs(text, win)
  const logo = await findLogo(c, fm.logo, hints)

  // The CLI's --template wins; its relative .typ resolves from the caller's folder.
  const tplValue = opts.template || fm.template
  const tpl = await templateFile(c, tplValue, opts.template ? cwd : baseDir, !opts.template)
  let profile: Manifest['profile'] = null
  const yaml = tpl === null ? null : await findProfileYaml(c, fm.profile, tplValue, tpl)
  if (yaml !== null) {
    const dir = P.dirname(yaml)
    const files: string[] = []
    const yamlText = new TextDecoder('utf-8').decode(await fs.readFile(yaml))
    for (const name of profileImageNames(yamlText)) {
      // Bare names only, joined literally: never `~`, $VAR or a drive prefix (`C:x.png`), and
      // nothing that lands outside the profile's own folder. The content is what isSafeImage
      // checked; the file may be a symlink to elsewhere, so the scripts copy its content and
      // must not assume where it lives.
      if (win && name.includes(':')) continue
      const p = P.join(dir, name)
      if (P.dirname(p) !== dir || P.basename(p) !== name) continue
      if ((await isFile(p)) && (await isSafeImage(p))) files.push(p)
    }
    profile = { yaml, files }
  }
  return { manifest: { note, images, logo, profile }, hints }
}

async function realOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p)
  } catch {
    return null
  }
}

/**
 * True if `p` (symlinks resolved) lies below `root` (resolved), optionally with no dot segment
 * (`.config`, `.ssh`, …) between them.
 */
async function realUnder(c: Ctx, p: string, root: string, noDot: boolean): Promise<boolean> {
  if (!root) return false
  const real = await realOrNull(p)
  const r = await realOrNull(root)
  if (real === null || r === null) return false
  const rel = c.P.relative(r, real)
  if (rel === '' || rel === '..' || rel.startsWith(`..${c.P.sep}`) || c.P.isAbsolute(rel)) {
    return false
  }
  return !(noDot && rel.split(/[\\/]/).some((seg) => seg.startsWith('.')))
}

/**
 * Why: `profile:` comes from note text, and the YAML lands in the staging root, where note Typst
 * code (mitex passthroughs) can read it — `profile: ~/.config/gh/hosts.yml`, or a symlink
 * `profiles/p.yaml -> ~/.config/gh/hosts.yml` in a cloned note folder, would stage a token file.
 * A path value must lie (symlinks resolved) under the note's folder (or MDO_BASE_DIR, which
 * relative values resolve against) or the templates folder, with no dot segment below either.
 */
async function insideProfileRoots(c: Ctx, p: string): Promise<boolean> {
  for (const root of [c.noteDir, c.baseDir, c.templatesDir]) {
    if (await realUnder(c, p, root, true)) return true
  }
  return false
}

const outsideRoots = (value: string) =>
  new ManifestError(`Profil muss im Ordner der Notiz oder im Vorlagen-Ordner liegen: ${value}`)

/**
 * The profile lookup of the scripts: a name -> profiles/<name>.yaml in the note's folder (or
 * MDO_BASE_DIR), <templates>/<set>/profiles, <templates>/profiles, then the set's own folder;
 * a value on .yaml/.yml -> that file (relative to the note, `~`/$VAR expanded), but only under
 * the note's or the templates folder (insideProfileRoots; stricter than the scripts were). Not found or
 * invalid -> ManifestError with the scripts' message. Only called once the set was found: with a
 * missing set the script fails first, with its own message.
 */
async function findProfileYaml(
  c: Ctx,
  value: string,
  tplValue: string,
  tpl: string,
): Promise<string | null> {
  if (!value) return null
  if (NAME_RE.test(value)) {
    const setName = tplValue === '' ? 'memo' : NAME_RE.test(tplValue) ? tplValue : ''
    const setDir = c.P.dirname(tpl)
    // Each place with the roots its hit must stay under (symlinks resolved, see
    // insideProfileRoots): the note's folder without dot segments, the templates folder, the
    // set's folder. <templates>/<set>/profiles also accepts the set folder itself: an installed
    // set is often a symlink to the user's clone (<templates>/din5008a -> ~/GitHub/…), whose real
    // path is outside the templates folder.
    const places: [string, string[], boolean][] = [
      [c.P.join(c.baseDir, 'profiles'), [c.baseDir], true],
    ]
    const userSet = setName && c.templatesDir ? c.P.join(c.templatesDir, setName) : ''
    if (userSet) places.push([c.P.join(userSet, 'profiles'), [c.templatesDir, userSet], false])
    if (c.templatesDir) places.push([c.P.join(c.templatesDir, 'profiles'), [c.templatesDir], false])
    // A set folder inside the templates folder is already place 2; naming it twice only confuses.
    if (!userSet || setDir !== userSet) places.push([c.P.join(setDir, 'profiles'), [setDir], false])
    const dirs = places.map(([d]) => d)
    for (const [dir, roots, noDot] of places) {
      const p = c.P.join(dir, `${value}.yaml`)
      if (!(await isFile(p))) continue
      // The first hit wins, as in the scripts; one that leads elsewhere is refused, not skipped.
      let inside = false
      for (const root of roots) inside ||= await realUnder(c, p, root, noDot)
      if (!inside) throw outsideRoots(value)
      return p
    }
    throw new ManifestError(`Profil nicht gefunden: ${value} (gesucht in ${dirs.join(', ')})`)
  }
  if (/\.ya?ml$/i.test(value)) {
    const e = expandNotePath(value, c.env, c.win)
    if (uncPath(c, e)) throw outsideRoots(value)
    const p = against(c, c.baseDir, e)
    if (!(await isFile(p))) throw new ManifestError(`Profil nicht gefunden: ${value}`)
    if (!(await insideProfileRoots(c, p))) throw outsideRoots(value)
    return p
  }
  throw new ManifestError(
    `${c.win ? 'ungueltiges' : 'ungültiges'} Profil: ${value} (erlaubt: Name aus a-z, 0-9, _ und - oder eine .yaml-Datei)`,
  )
}

/**
 * Writes the manifest of `notePath` as manifest.json into a fresh private folder (mode 700,
 * named and marked like a staging folder, so one left behind by a killed export is swept like
 * one) and returns the file's path. Hints go to `hint` (stderr in the CLI). The caller removes
 * the folder with removeManifest once the script has ended, also on failure.
 */
export async function writeManifest(
  notePath: string,
  opts: ManifestOptions,
  hint: (line: string) => void = () => {},
): Promise<string> {
  const { manifest, hints } = await buildManifest(notePath, opts)
  for (const h of hints) hint(h)
  const tmp = opts.tmpDir ?? os.tmpdir()
  await fs.mkdir(tmp, { recursive: true })
  const dir = await fs.mkdtemp(path.join(tmp, STAGE_PREFIX))
  try {
    await fs.chmod(dir, 0o700)
    await fs.writeFile(path.join(dir, STAGE_MARKER), '', { mode: 0o600 })
    const file = path.join(dir, 'manifest.json')
    await fs.writeFile(file, `${JSON.stringify(manifest)}\n`, { mode: 0o600 })
    return file
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true })
    throw err
  }
}

/** Removes the folder writeManifest created for `file`. Never throws. */
export async function removeManifest(file: string): Promise<void> {
  const dir = path.dirname(file)
  if (!path.basename(dir).startsWith(STAGE_PREFIX)) return
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
}

/**
 * Removes staging folders that a killed export (SIGKILL after the app's timeout, taskkill /F)
 * could not clean up: `mdo-stage-*` folders directly in `tmpDir` that are real folders (never a
 * symlink), carry the marker as a regular file older than one hour, and belong to this user.
 * Everything else is left alone; errors are ignored (best effort, the export goes on). fs.rm
 * removes links inside a folder without following them.
 */
export async function sweepStaleStages(tmpDir: string, now: number): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(tmpDir, { withFileTypes: true })
  } catch {
    return
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  for (const e of entries) {
    if (!e.name.startsWith(STAGE_PREFIX) || !e.isDirectory()) continue
    const dir = path.join(tmpDir, e.name)
    try {
      const st = await fs.lstat(dir)
      if (!st.isDirectory() || (uid !== null && st.uid !== uid)) continue
      const marker = await fs.lstat(path.join(dir, STAGE_MARKER))
      if (!marker.isFile() || now - marker.mtimeMs < STALE_MS) continue
      await fs.rm(dir, { recursive: true, force: true })
    } catch {
      // No marker, gone meanwhile, or not removable: not ours to worry about.
    }
  }
}
