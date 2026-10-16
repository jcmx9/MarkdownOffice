import { promises as fs } from 'node:fs'

/** A header template larger than this is not a header (protects the renderer). */
const MAX_BYTES = 64 * 1024

/**
 * A set's header template (all front-matter keys with defaults and comments, e.g.
 * `<sets>/memo/memo.header.md`) as text without a BOM. null when it is missing, too
 * large or not UTF-8.
 */
export async function readHeaderTemplate(file: string): Promise<string | null> {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > MAX_BYTES) return null
    const bytes = await fs.readFile(file)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.startsWith('﻿') ? text.slice(1) : text
  } catch {
    return null
  }
}
