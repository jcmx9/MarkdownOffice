import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { UpdateResult } from '../../shared/types'
import {
  dictionaryPath,
  isSafeDictionaryName,
  knownTable,
  PENDING,
  parseTable,
  readState,
  sha256,
  tempName,
  withStateLock,
  writeState,
  writeTable,
} from './dictionaries'

/**
 * Dictionary updates and downloads (Windows/Linux) come only from this repo's GitHub releases,
 * never from Google: each release has the .bdic files, SHA256SUMS and dictionaries.json. A file
 * replaces the installed one only after its checksum matched (an open one at the next start);
 * any failure keeps what works.
 */
export const REPO = 'jcmx9/MarkdownOffice-dictionaries'
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const DAY = 24 * 60 * 60 * 1000
/**
 * Every request (headers and body) ends after this: the whole check runs under the state lock,
 * so a stalled connection must not block declines, downloads and later checks forever.
 */
export const FETCH_TIMEOUT_MS = 30_000

export type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>
interface Net {
  fetch: Fetch
  /** Only tests shorten it. */
  timeoutMs?: number
}
interface Release {
  version: string
  /** Download URL of the asset, matched case-insensitively. */
  asset: (name: string) => string | null
}
/** A dictionary file of the release: asset name as published, checksum, canonical install name. */
interface Entry {
  asset: string
  sum: string
  canonical: string
}

/** One request with its own timeout signal; the signal also aborts reading the body. */
const get = (n: Net, url: string): Promise<Response> =>
  n.fetch(url, { signal: AbortSignal.timeout(n.timeoutMs ?? FETCH_TIMEOUT_MS) })

async function latest(n: Net): Promise<Release> {
  const r = await get(n, LATEST)
  if (!r.ok) throw new Error(`Release-Abfrage: HTTP ${r.status}`)
  const j = (await r.json()) as {
    tag_name?: string
    assets?: { name: string; browser_download_url: string }[]
  }
  const version = (j.tag_name ?? '').replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release ohne gültige Version')
  const assets = j.assets ?? []
  return {
    version,
    asset: (name) =>
      assets.find((a) => a.name.toLowerCase() === name.toLowerCase())?.browser_download_url ?? null,
  }
}

/**
 * Fetches the release's dictionaries.json and caches it (offered languages, code → file).
 * Optional: a missing or broken table keeps the cached or built-in one and never fails a check.
 */
async function refreshTable(n: Net, rel: Release, dir: string): Promise<void> {
  const url = rel.asset('dictionaries.json')
  if (!url) return
  try {
    const r = await get(n, url)
    if (!r.ok) return
    const table = parseTable(await r.json())
    if (table.length > 0) await writeTable(dir, table)
  } catch (err) {
    // A timeout here must still end the check normally (the files may be fine).
    console.warn('spellcheck: dictionaries.json unusable', err)
  }
}

/**
 * Reads SHA256SUMS: lowercase asset name → { asset, sum }. Lines whose name could not be a
 * plain .bdic base name (separators, `..`) are ignored, so they can never become a path.
 */
async function sums(n: Net, rel: Release): Promise<Map<string, { asset: string; sum: string }>> {
  const url = rel.asset('SHA256SUMS')
  if (!url) throw new Error('SHA256SUMS fehlt')
  const r = await get(n, url)
  if (!r.ok) throw new Error(`SHA256SUMS: HTTP ${r.status}`)
  const out = new Map<string, { asset: string; sum: string }>()
  for (const line of (await r.text()).split('\n')) {
    const p = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(\S+)$/)
    const [, sum, asset] = p ?? []
    if (sum && asset && isSafeDictionaryName(asset))
      out.set(asset.toLowerCase(), { asset, sum: sum.toLowerCase() })
  }
  return out
}

/**
 * The release files for `codes`: the table names the file Chromium opens for each code (also
 * the install name); SHA256SUMS lists it case-insensitively. Codes without a file are skipped.
 */
async function entriesFor(n: Net, rel: Release, dir: string, codes: string[]): Promise<Entry[]> {
  const listed = await sums(n, rel)
  const table = await knownTable(dir)
  const out: Entry[] = []
  for (const code of codes) {
    const file = table.find((d) => d.code === code)?.file
    const s = file ? listed.get(file.toLowerCase()) : undefined
    if (file && s) out.push({ ...s, canonical: file })
  }
  return out
}

/**
 * Downloads the entry and verifies it before anything is written. A file that already exists
 * may be open in Chromium (Windows refuses a rename over it, and an unchanged language list
 * does not reload it), so the new one is staged as `<file>.pending` and activated at the next
 * start (installBundledDictionaries). A file that does not exist yet was never opened: it is
 * moved into place at once. Both go through a unique temp file + rename.
 */
async function install(
  n: Net,
  rel: Release,
  dir: string,
  e: Entry,
): Promise<{ sum: string; pending: boolean }> {
  const dest = dictionaryPath(dir, e.canonical)
  dictionaryPath(dir, e.asset) // the asset name is network data too: same guard
  const url = rel.asset(e.asset)
  if (!url) throw new Error(`${e.asset} fehlt im Release`)
  const r = await get(n, url)
  if (!r.ok) throw new Error(`${e.asset}: HTTP ${r.status}`)
  const bytes = Buffer.from(await r.arrayBuffer())
  const sum = sha256(bytes)
  // Verified before anything is written: a wrong file never touches the working one.
  if (sum !== e.sum) throw new Error(`${e.asset}: Prüfsumme falsch`)
  await fs.mkdir(dir, { recursive: true })
  const pending = await fs.stat(dest).then(
    () => true,
    () => false,
  )
  const tmp = join(dir, tempName(e.canonical))
  await fs.writeFile(tmp, bytes)
  await fs.rename(tmp, pending ? `${dest}${PENDING}` : dest)
  return { sum, pending }
}

export function checkForUpdates(
  o: Net & { dir: string; codes: string[]; force: boolean; now: number },
): Promise<UpdateResult> {
  // Whole check under the state lock: the state read at the start is still current at the end.
  // Every request has a timeout (FETCH_TIMEOUT_MS), so the lock is always released.
  return withStateLock(o.dir, () => runCheck(o))
}

async function runCheck(
  o: Net & { dir: string; codes: string[]; force: boolean; now: number },
): Promise<UpdateResult> {
  const state = await readState(o.dir)
  // lastCheck 0 = never checked; otherwise at most one automatic check per day.
  if (!o.force && state.lastCheck > 0 && o.now - state.lastCheck < DAY) return { kind: 'skipped' }
  try {
    const rel = await latest(o)
    await refreshTable(o, rel, o.dir)
    if (state.version === rel.version) {
      await writeState(o.dir, { ...state, lastCheck: o.now })
      return { kind: 'current' }
    }
    const wanted = await entriesFor(o, rel, o.dir, o.codes)
    const files: string[] = []
    let pending = false
    try {
      for (const e of wanted) {
        const r = await install(o, rel, o.dir, e)
        // Recorded for staged files too: activation checks this hash, and bundled files never
        // overwrite a file the update installed.
        state.files[e.canonical] = r.sum
        pending ||= r.pending
        files.push(e.canonical)
      }
    } catch (err) {
      // Files installed before the failure stay (they are verified); the version is not
      // recorded, so the next check retries the whole set. Their hashes must be remembered
      // so bundled files never overwrite them.
      await writeState(o.dir, { ...state, lastCheck: o.now }).catch(() => undefined)
      throw err
    }
    state.version = rel.version
    state.lastCheck = o.now
    await writeState(o.dir, state)
    return { kind: 'updated', version: rel.version, files, pending }
  } catch (e) {
    await writeState(o.dir, { ...state, lastCheck: o.now }).catch(() => undefined)
    return { kind: 'failed', reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Installs one language from the latest release (verified): 'installed' when it is in place
 * now (it was missing, so Chromium never opened it), 'pending' when an existing file was
 * staged for the next start, 'failed' on any failure.
 */
export function downloadDictionary(
  o: Net & { dir: string; code: string },
): Promise<'installed' | 'pending' | 'failed'> {
  return withStateLock(o.dir, () => runDownload(o))
}

async function runDownload(
  o: Net & { dir: string; code: string },
): Promise<'installed' | 'pending' | 'failed'> {
  try {
    const rel = await latest(o)
    await refreshTable(o, rel, o.dir)
    const [e] = await entriesFor(o, rel, o.dir, [o.code])
    if (!e) return 'failed'
    const state = await readState(o.dir)
    const r = await install(o, rel, o.dir, e)
    state.files[e.canonical] = r.sum
    await writeState(o.dir, state)
    return r.pending ? 'pending' : 'installed'
  } catch {
    return 'failed'
  }
}
