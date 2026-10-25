import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import type { HeaderDefault, Session, SessionTab, Settings } from '../shared/types'
import { writeFileAtomic } from './files'

export const MAX_RECENT = 10

export const DEFAULT_SESSION: Session = {
  tabs: [],
  activeIndex: 0,
  mode: 'edit',
  view: 'preview',
  zoom: { edit: 1, present: 1 },
  outline: { edit: false, present: false },
  toolbar: { edit: true },
  recent: [],
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const absPath = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' && isAbsolute(v) ? v : null
const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

export function defaultSettings(documentsDir: string): Settings {
  const defaultFolder = join(documentsDir, 'Markdown Office')
  return {
    defaultFolder,
    snippetFolder: join(defaultFolder, 'Snippets'),
    presentFontFactor: 1.6,
    headerDefault: 'yaml',
    // Spell checking is on by default; updates of the bundled dictionaries too (Windows/Linux).
    spellcheck: true,
    dictionaryAutoUpdate: true,
  }
}

export const FACTOR_MIN = 1
export const FACTOR_MAX = 3

const headerDefault = (v: unknown): HeaderDefault | null =>
  v === 'yaml' || v === 'titleblock' ? v : null

export function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  const o = isObj(raw) ? raw : {}
  const defaultFolder = absPath(o.defaultFolder) ?? defaults.defaultFolder
  return {
    defaultFolder,
    snippetFolder: absPath(o.snippetFolder) ?? defaults.snippetFolder,
    presentFontFactor: clamp(
      o.presentFontFactor,
      FACTOR_MIN,
      FACTOR_MAX,
      defaults.presentFontFactor,
    ),
    headerDefault: headerDefault(o.headerDefault) ?? defaults.headerDefault,
    // Only real booleans count; anything else (a hand-edited file) falls back to the default.
    spellcheck: typeof o.spellcheck === 'boolean' ? o.spellcheck : defaults.spellcheck,
    dictionaryAutoUpdate:
      typeof o.dictionaryAutoUpdate === 'boolean'
        ? o.dictionaryAutoUpdate
        : defaults.dictionaryAutoUpdate,
  }
}

/**
 * Applies a patch from the settings dialog. Unlike loading, nothing is clamped or derived:
 * every invalid value is rejected and the current one kept, so bad input never persists.
 */
export function settingsPatch(current: Settings, raw: unknown): Settings {
  const o = isObj(raw) ? raw : {}
  const next = { ...current }
  const folder = (key: 'defaultFolder' | 'snippetFolder') => {
    const p = absPath(o[key])
    if (p) next[key] = p
  }
  folder('defaultFolder')
  folder('snippetFolder')
  const f = o.presentFontFactor
  if (typeof f === 'number' && Number.isFinite(f) && f >= FACTOR_MIN && f <= FACTOR_MAX)
    next.presentFontFactor = f
  next.headerDefault = headerDefault(o.headerDefault) ?? current.headerDefault
  // A non-boolean switch value is rejected like any other invalid input: the current one stays.
  if (typeof o.spellcheck === 'boolean') next.spellcheck = o.spellcheck
  if (typeof o.dictionaryAutoUpdate === 'boolean')
    next.dictionaryAutoUpdate = o.dictionaryAutoUpdate
  return next
}

export function sanitizeSession(raw: unknown): Session {
  const o = isObj(raw) ? raw : {}
  const tabs: SessionTab[] = Array.isArray(o.tabs)
    ? o.tabs.flatMap((t) => {
        if (!isObj(t)) return []
        const path = absPath(t.path)
        return path ? [{ path, headerHidden: t.headerHidden === true }] : []
      })
    : []
  const zoom = isObj(o.zoom) ? o.zoom : {}
  const outline = isObj(o.outline) ? o.outline : {}
  const toolbar = isObj(o.toolbar) ? o.toolbar : {}
  return {
    tabs,
    activeIndex: tabs.length ? Math.trunc(clamp(o.activeIndex, 0, tabs.length - 1, 0)) : 0,
    mode: o.mode === 'present' ? 'present' : 'edit',
    view: o.view === 'code' ? 'code' : 'preview',
    zoom: { edit: clamp(zoom.edit, 0.5, 3, 1), present: clamp(zoom.present, 0.5, 3, 1) },
    outline: { edit: outline.edit === true, present: outline.present === true },
    // Default on (spec): sessions written before the toolbar existed show it; only an explicit
    // false (the user switched it off) hides it.
    toolbar: { edit: toolbar.edit !== false },
    recent: Array.isArray(o.recent)
      ? o.recent
          .map(absPath)
          .filter((p): p is string => p !== null)
          .slice(0, MAX_RECENT)
      : [],
  }
}

/** Missing → undefined. Corrupt → moved to `<file>.corrupt`, undefined. */
export async function loadJson(path: string): Promise<unknown> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch {
    return undefined
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    await fs.rename(path, `${path}.corrupt`).catch(() => undefined)
    return undefined
  }
}

export async function saveJson(path: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8'))
}
