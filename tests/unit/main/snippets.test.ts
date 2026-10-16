import { execFileSync } from 'node:child_process'
import { closeSync, constants, openSync } from 'node:fs'
import { mkdir, mkdtemp, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadUserSnippets } from '../../../src/main/snippets'

async function dir(files: Record<string, string | Buffer>): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'mdo-snip-'))
  for (const [name, body] of Object.entries(files)) await writeFile(join(d, name), body)
  return d
}

describe('loadUserSnippets', () => {
  it('reads *.tpl.md sorted by name, keeping bytes', async () => {
    const d = await dir({ 'zeta.tpl.md': 'Z $1', 'Ä-1.tpl.md': 'A\r\nB', 'note.md': 'no' })
    expect(await loadUserSnippets(d)).toEqual(
      [
        { name: 'zeta', body: 'Z $1', source: 'user' },
        { name: 'Ä-1', body: 'A\r\nB', source: 'user' },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    )
  })

  it('returns [] for a missing folder and does not create it', async () => {
    const missing = join(tmpdir(), `mdo-none-${Date.now()}`)
    expect(await loadUserSnippets(missing)).toEqual([])
    await expect(stat(missing)).rejects.toThrow()
  })

  it('skips invalid UTF-8, oversized files, bad names and directories', async () => {
    const d = await dir({
      'bin.tpl.md': Buffer.from([0xff, 0xfe, 0x00]),
      'big.tpl.md': 'x'.repeat(64 * 1024 + 1),
      'bad name.tpl.md': 'x',
      'ok.tpl.md': 'ok',
    })
    await mkdir(join(d, 'dir.tpl.md'))
    expect((await loadUserSnippets(d)).map((s) => s.name)).toEqual(['ok'])
  })

  it('strips a UTF-8 BOM', async () => {
    const d = await dir({ 'b.tpl.md': Buffer.from('﻿hi', 'utf8') })
    expect((await loadUserSnippets(d))[0]?.body).toBe('hi')
  })

  it('normalizes NFD file names to NFC', async () => {
    const d = await dir({ [`${'A\u0308'}rger.tpl.md`]: 'x' })
    expect((await loadUserSnippets(d)).map((s) => s.name)).toEqual(['\u00C4rger'])
  })

  it.skipIf(process.platform === 'win32')(
    'never opens a FIFO (it would block a libuv thread); a symlink to a file is fine',
    async () => {
      const d = await dir({ 'real.tpl.md': 'R', 'ok.tpl.md': 'ok' })
      const fifo = join(d, 'pipe.tpl.md')
      execFileSync('mkfifo', [fifo])
      await symlink(join(d, 'real.tpl.md'), join(d, 'link.tpl.md'))
      await symlink(fifo, join(d, 'pipelink.tpl.md'))
      try {
        const result = await Promise.race([
          loadUserSnippets(d),
          new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 1500)),
        ])
        expect(result === 'blocked' ? result : result.map((s) => s.name)).toEqual([
          'link',
          'ok',
          'real',
        ])
      } finally {
        // Release a reader that may be blocked on the FIFO (only possible while one waits).
        try {
          closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK))
        } catch {
          // ENXIO: nobody is waiting, which is the expected case.
        }
      }
    },
  )
})
