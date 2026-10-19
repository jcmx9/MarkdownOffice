import { promises as fsp, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { lstat, mkdtemp, readdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RenameError, renameNote, validateNewName } from '../../../src/main/files'

function detectCaseSensitive(): boolean {
  const d = mkdtempSync(join(tmpdir(), 'mdo-case-'))
  try {
    writeFileSync(join(d, 'x.md'), '')
    writeFileSync(join(d, 'X.md'), '')
    return readdirSync(d).length === 2
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
}

// Evaluated synchronously at load time, because skipIf() reads it during collection.
const caseSensitive = detectCaseSensitive()

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdo-rename-'))
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('validateNewName', () => {
  it.each([
    ['Kickoff', 'Kickoff.md'],
    ['  Kickoff.md ', 'Kickoff.md'],
    ['Notiz.MD', 'Notiz.MD'],
  ])('%j → %j', (input, out) => expect(validateNewName(input)).toBe(out))

  it.each([
    ['kanzlei2', '/p/kanzlei.yaml', 'kanzlei2.yaml'],
    ['kanzlei2', '/p/kanzlei.yml', 'kanzlei2.yml'],
    ['kanzlei2.yml', '/p/kanzlei.yaml', 'kanzlei2.yml'],
    ['notiz', '/p/a.md', 'notiz.md'],
  ])('%j renaming %j → %j (a profile stays YAML)', (input, from, out) =>
    expect(validateNewName(input, from)).toBe(out),
  )

  it.each([
    '',
    '   ',
    '.',
    '..',
    'a/b',
    'a\\b',
    'a:b',
    'a?b',
    'a*b',
    'a<b',
    'a|b',
    'a"b',
    'tab\tname',
  ])('rejects %j', (input) => expect(() => validateNewName(input)).toThrow(RenameError))
})

describe('renameNote', () => {
  it('renames within the same folder', async () => {
    const from = join(dir, 'a.md')
    await writeFile(from, 'A')
    const to = await renameNote(from, 'Kickoff')
    expect(to).toBe(join(dir, 'Kickoff.md'))
    expect(await readdir(dir)).toEqual(['Kickoff.md'])
    expect(await readFile(to, 'utf8')).toBe('A')
  })

  it('never overwrites an existing file', async () => {
    const from = join(dir, 'a.md')
    await writeFile(from, 'A')
    await writeFile(join(dir, 'b.md'), 'B')
    await expect(renameNote(from, 'b')).rejects.toThrow(/existiert bereits/)
    expect(await readFile(from, 'utf8')).toBe('A')
    expect(await readFile(join(dir, 'b.md'), 'utf8')).toBe('B')
  })

  it('supports a case-only rename', async () => {
    const from = join(dir, 'notiz.md')
    await writeFile(from, 'N')
    const to = await renameNote(from, 'Notiz')
    expect(await readdir(dir)).toEqual(['Notiz.md'])
    expect(await readFile(to, 'utf8')).toBe('N')
  })

  it.skipIf(!caseSensitive)(
    'refuses a case-only rename onto a different existing file (case-sensitive FS)',
    async () => {
      await writeFile(join(dir, 'x.md'), 'lower')
      await writeFile(join(dir, 'X.md'), 'upper')
      await expect(renameNote(join(dir, 'x.md'), 'X')).rejects.toThrow(RenameError)
      expect(await readFile(join(dir, 'X.md'), 'utf8')).toBe('upper')
      expect(await readFile(join(dir, 'x.md'), 'utf8')).toBe('lower')
    },
  )

  it('refuses a case-only rename when the files cannot be proven identical (any FS)', async () => {
    await writeFile(join(dir, 'x.md'), 'lower')
    if (caseSensitive) await writeFile(join(dir, 'X.md'), 'upper')
    // Pretend `X` is a different inode than `x`, so sameFile() reports two files.
    const realStat = fsp.stat
    vi.spyOn(fsp, 'stat').mockImplementation(async (path) => {
      const s = await realStat(path, { bigint: true })
      return String(path).endsWith('X.md') ? { ...s, ino: s.ino + 1n } : s
    })
    await expect(renameNote(join(dir, 'x.md'), 'X')).rejects.toThrow(RenameError)
    expect(await readFile(join(dir, 'x.md'), 'utf8')).toBe('lower')
    if (caseSensitive) expect(await readFile(join(dir, 'X.md'), 'utf8')).toBe('upper')
  })

  it('returns the same path when the name is unchanged', async () => {
    const from = join(dir, 'same.md')
    await writeFile(from, 'S')
    expect(await renameNote(from, 'same')).toBe(from)
  })

  describe('when hard links are unsupported (EPERM fallback)', () => {
    const linkUnsupported = (): void => {
      vi.spyOn(fsp, 'link').mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    }

    it('renames when the target is free', async () => {
      linkUnsupported()
      const from = join(dir, 'a.md')
      await writeFile(from, 'A')
      const to = await renameNote(from, 'Kickoff')
      expect(to).toBe(join(dir, 'Kickoff.md'))
      expect(await readdir(dir)).toEqual(['Kickoff.md'])
      expect(await readFile(to, 'utf8')).toBe('A')
    })

    it('refuses when the target exists and leaves it unchanged', async () => {
      linkUnsupported()
      const from = join(dir, 'a.md')
      await writeFile(from, 'A')
      await writeFile(join(dir, 'b.md'), 'B')
      await expect(renameNote(from, 'b')).rejects.toThrow(/existiert bereits/)
      expect(await readFile(from, 'utf8')).toBe('A')
      expect(await readFile(join(dir, 'b.md'), 'utf8')).toBe('B')
    })
  })

  it.skipIf(process.platform === 'win32')('renames a symlink itself, not its target', async () => {
    const target = join(dir, 'target.md')
    await writeFile(target, 'T')
    const from = join(dir, 'a.md')
    await symlink(target, from)
    const to = await renameNote(from, 'b')
    expect(to).toBe(join(dir, 'b.md'))
    expect((await lstat(to)).isSymbolicLink()).toBe(true)
    expect(await readlink(to)).toBe(target)
    expect(await readFile(target, 'utf8')).toBe('T')
    await expect(lstat(from)).rejects.toThrow()
  })

  describe('unlink failure after link', () => {
    afterEach(() => vi.restoreAllMocks())

    function failUnlink(code: string, times: number) {
      const real = fsp.unlink.bind(fsp)
      let left = times
      return vi.spyOn(fsp, 'unlink').mockImplementation(async (path) => {
        if (String(path).endsWith('a.md') && left-- > 0) {
          throw Object.assign(new Error(code), { code })
        }
        return real(path)
      })
    }

    it('retries a transient EBUSY and completes the rename', async () => {
      const from = join(dir, 'a.md')
      await writeFile(from, 'A')
      failUnlink('EBUSY', 2)
      const to = await renameNote(from, 'b', async () => undefined)
      expect(await readFile(to, 'utf8')).toBe('A')
      await expect(lstat(from)).rejects.toThrow()
    })

    it('rolls back and throws RenameError when unlink never succeeds', async () => {
      const from = join(dir, 'a.md')
      await writeFile(from, 'A')
      failUnlink('EPERM', Number.POSITIVE_INFINITY)
      await expect(renameNote(from, 'b', async () => undefined)).rejects.toThrow(
        /konnte nicht umbenannt werden: Datei ist in Benutzung/,
      )
      expect(await readFile(from, 'utf8')).toBe('A')
      await expect(lstat(join(dir, 'b.md'))).rejects.toThrow()
    })
  })
})
