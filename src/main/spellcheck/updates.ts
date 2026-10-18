import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { UpdateResult } from '../../shared/types'
import { codeOf, readState, sha256, tempName, withStateLock, writeState } from './dictionaries'

/**
 * Dictionary updates and downloads (Windows/Linux) come only from this repo's GitHub releases,
 * never from Google: each release has the .bdic files, SHA256SUMS and dictionaries.json. A file
 * replaces the installed one only after its checksum matched; any failure keeps what works.
 */
export const REPO = 'jcmx9/MarkdownOffice-dictionaries'
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`
const DAY = 24 * 60 * 60 * 1000

type Fetch = (url: string) => Promise<Response>
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

async function latest(fetch: Fetch): Promise<Release> {
  const r = await fetch(LATEST)
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
    asset: (n) =>
      assets.find((a) => a.name.toLowerCase() === n.toLowerCase())?.browser_download_url ?? null,
  }
}

/**
 * The name Chromium looks up (`de-DE-3-0.bdic`): language lower, 2-letter region upper. An
 * already installed file of the same code wins, so an update never leaves a second copy.
 */
function canonicalName(asset: string, installed: string[]): string {
  const existing = installed.find((f) => codeOf(f) === codeOf(asset))
  if (existing) return existing
  return asset
    .split('-')
    .map((p, i) => (i === 0 ? p.toLowerCase() : /^[a-z]{2}$/i.test(p) ? p.toUpperCase() : p))
    .join('-')
}

/** Reads SHA256SUMS: one Entry per .bdic line. */
async function entries(fetch: Fetch, rel: Release, dir: string): Promise<Entry[]> {
  const url = rel.asset('SHA256SUMS')
  if (!url) throw new Error('SHA256SUMS fehlt')
  const r = await fetch(url)
  if (!r.ok) throw new Error(`SHA256SUMS: HTTP ${r.status}`)
  const installed = await fs.readdir(dir).catch(() => [] as string[])
  const out: Entry[] = []
  for (const line of (await r.text()).split('\n')) {
    const p = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(\S+)$/)
    const [, sum, asset] = p ?? []
    if (sum && asset && /\.bdic$/i.test(asset))
      out.push({ asset, sum: sum.toLowerCase(), canonical: canonicalName(asset, installed) })
  }
  return out
}

/** Downloads the entry, verifies it and replaces the installed file atomically (temp + rename). */
async function install(fetch: Fetch, rel: Release, dir: string, e: Entry): Promise<string> {
  const url = rel.asset(e.asset)
  if (!url) throw new Error(`${e.asset} fehlt im Release`)
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${e.asset}: HTTP ${r.status}`)
  const bytes = Buffer.from(await r.arrayBuffer())
  const got = sha256(bytes)
  // Verified before anything is written: a wrong file never touches the working one.
  if (got !== e.sum) throw new Error(`${e.asset}: Prüfsumme falsch`)
  await fs.mkdir(dir, { recursive: true })
  const tmp = join(dir, tempName(e.canonical))
  await fs.writeFile(tmp, bytes)
  await fs.rename(tmp, join(dir, e.canonical))
  return got
}

export function checkForUpdates(o: {
  dir: string
  fetch: Fetch
  codes: string[]
  force: boolean
  now: number
}): Promise<UpdateResult> {
  // Whole check under the state lock: the state read at the start is still current at the end.
  return withStateLock(o.dir, () => runCheck(o))
}

async function runCheck(o: {
  dir: string
  fetch: Fetch
  codes: string[]
  force: boolean
  now: number
}): Promise<UpdateResult> {
  const state = await readState(o.dir)
  // lastCheck 0 = never checked; otherwise at most one automatic check per day.
  if (!o.force && state.lastCheck > 0 && o.now - state.lastCheck < DAY) return { kind: 'skipped' }
  try {
    const rel = await latest(o.fetch)
    if (state.version === rel.version) {
      await writeState(o.dir, { ...state, lastCheck: o.now })
      return { kind: 'current' }
    }
    const wanted = (await entries(o.fetch, rel, o.dir)).filter((e) =>
      o.codes.includes(codeOf(e.asset)),
    )
    const files: string[] = []
    try {
      for (const e of wanted) {
        state.files[e.canonical] = await install(o.fetch, rel, o.dir, e)
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
    return { kind: 'updated', version: rel.version, files }
  } catch (e) {
    await writeState(o.dir, { ...state, lastCheck: o.now }).catch(() => undefined)
    return { kind: 'failed', reason: e instanceof Error ? e.message : String(e) }
  }
}

/** Installs one language from the latest release (verified); false on any failure. */
export function downloadDictionary(o: {
  dir: string
  fetch: Fetch
  code: string
}): Promise<boolean> {
  return withStateLock(o.dir, () => runDownload(o))
}

async function runDownload(o: { dir: string; fetch: Fetch; code: string }): Promise<boolean> {
  try {
    const rel = await latest(o.fetch)
    const e = (await entries(o.fetch, rel, o.dir)).find((x) => codeOf(x.asset) === o.code)
    if (!e) return false
    const state = await readState(o.dir)
    state.files[e.canonical] = await install(o.fetch, rel, o.dir, e)
    await writeState(o.dir, state)
    return true
  } catch {
    return false
  }
}
