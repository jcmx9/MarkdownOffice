import { constants } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { SNIPPET_EXT, SNIPPET_NAME_RE } from '../shared/snippets'
import type { SnippetDef } from '../shared/types'

const MAX_BYTES = 64 * 1024
const BOM = '﻿'
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
// O_NONBLOCK (POSIX only) keeps a FIFO swapped in after the stat check from blocking open().
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)

/** Reads the user's snippet templates; a missing folder yields an empty list. */
export async function loadUserSnippets(dir: string): Promise<SnippetDef[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('Markdown Office: snippet folder unreadable', dir, err)
    }
    return []
  }
  const out: SnippetDef[] = []
  for (const file of names) {
    if (!file.endsWith(SNIPPET_EXT)) continue
    const name = file.slice(0, -SNIPPET_EXT.length).normalize('NFC')
    if (!SNIPPET_NAME_RE.test(name)) continue
    try {
      const p = join(dir, file)
      // Only regular files (symlinks followed): opening a FIFO would block a libuv thread for good.
      if (!(await stat(p)).isFile()) continue
      const fh = await open(p, OPEN_FLAGS)
      let buf: Buffer
      try {
        if (!(await fh.stat()).isFile()) continue
        const chunk = Buffer.alloc(MAX_BYTES + 1)
        const { bytesRead } = await fh.read(chunk, 0, MAX_BYTES + 1, 0)
        if (bytesRead > MAX_BYTES) continue
        buf = chunk.subarray(0, bytesRead)
      } finally {
        await fh.close()
      }
      let body = utf8.decode(buf)
      if (body.startsWith(BOM)) body = body.slice(1)
      out.push({ name, body, source: 'user' })
    } catch (err) {
      console.warn('Markdown Office: snippet skipped', file, err)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
