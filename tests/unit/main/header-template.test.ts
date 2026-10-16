import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readHeaderTemplate } from '../../../src/main/header-template'

const dir = () => mkdtemp(join(tmpdir(), 'mdo-header-'))

describe('readHeaderTemplate', () => {
  it('returns the header template as text without a BOM', async () => {
    const file = join(await dir(), 'memo.header.md')
    await writeFile(file, '\uFEFF---\ntemplate: memo\n---\n')
    expect(await readHeaderTemplate(file)).toBe('---\ntemplate: memo\n---\n')
  })

  it('returns null when the file is missing, not UTF-8, too large or a folder', async () => {
    const d = await dir()
    const file = join(d, 'memo.header.md')
    expect(await readHeaderTemplate(file)).toBeNull()
    await writeFile(file, Buffer.from([0x2d, 0xff, 0xfe]))
    expect(await readHeaderTemplate(file)).toBeNull()
    await writeFile(file, 'x'.repeat(65 * 1024))
    expect(await readHeaderTemplate(file)).toBeNull()
    expect(await readHeaderTemplate(d)).toBeNull()
  })
})
