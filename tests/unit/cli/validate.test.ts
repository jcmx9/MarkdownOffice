import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runValidate } from '../../../src/cli/validate'

let dir = ''
let env: Record<string, string> = {}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'mdo validate ')))
  const sets = path.join(dir, 'sets')
  mkdirSync(path.join(sets, 'memo'), { recursive: true })
  writeFileSync(path.join(sets, 'memo', 'memo.typ'), '')
  writeFileSync(
    path.join(sets, 'memo', 'memo.header.md'),
    '---\ntemplate: memo\ntitle:\nsubtitle:\n---\n',
  )
  env = { MDO_SETS_DIR: sets, MDO_TEMPLATES: path.join(dir, 'user') }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const note = (text: string | Buffer, name = 'n.md') => {
  const f = path.join(dir, name)
  writeFileSync(f, text)
  return f
}
async function run(args: string[]) {
  let out = ''
  let err = ''
  const code = await runValidate(
    args,
    env,
    (s) => (out += s),
    (s) => (err += s),
  )
  return { code, out, err }
}

// Paths go into RegExps below; on Windows `\\n`, `\\U` would otherwise act as escapes.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('validate: usage', () => {
  it.each([[[]], [['a.md', 'b.md']], [['a.md', '--nope']]])(
    'exit 2 with usage for %j',
    async (args) => {
      const r = await run(args)
      expect(r.code).toBe(2)
      expect(r.err).toContain('Aufruf: markdown-office validate')
    },
  )
  it('exit 2 for a missing file and for non-UTF-8 bytes', async () => {
    expect((await run([path.join(dir, 'missing.md')])).code).toBe(2)
    expect((await run([note(Buffer.from([0x2d, 0xff, 0xfe]))])).code).toBe(2)
  })
})

describe('validate: report', () => {
  it('clean note: exit 0 and "YAML in Ordnung"', async () => {
    const r = await run([note('---\ntitle: A\nsubtitle: B\ntemplate: memo\n---\ntext\n')])
    expect(r).toMatchObject({ code: 0, out: 'YAML in Ordnung\n' })
  })
  it('error: exit 1, one line per finding, then the missing keys', async () => {
    const f = note('---\ntitle: A\ndate: 31.04.2026\n---\n')
    const r = await run([f])
    expect(r.code).toBe(1)
    expect(r.out).toMatch(new RegExp(`^${escapeRegExp(f)}:3: Fehler: .*date`, 'm'))
    expect(r.out).toContain('Fehlende Schlüssel (memo): ')
  })
  it('warnings only: exit 0', async () => {
    const r = await run([note('---\ntitle: A\nsubtitle: B\ntoc: Yes\n---\n')])
    expect(r.code).toBe(0)
    expect(r.out).toContain(': Warnung: ')
    expect(r.out).toContain(' → ')
  })
  it('--json: one object and nothing else on stdout', async () => {
    const f = note('---\ntitle: A\ndate: 31.04.2026\n---\n')
    const r = await run([f, '--json'])
    const j = JSON.parse(r.out)
    expect(r.code).toBe(1)
    expect(j).toMatchObject({ file: f, set: 'memo', fixed: 0 })
    expect(j.findings[0]).toEqual(
      expect.objectContaining({
        line: 3,
        key: 'date',
        severity: 'error',
        code: expect.any(String),
        message: expect.any(String),
      }),
    )
    expect(j.findings[0]).toHaveProperty('suggestion')
    expect(j.missing).toEqual(expect.arrayContaining(['subtitle']))
  })
  it('a broken set schema: notice on stderr in both modes, stdout stays JSON', async () => {
    writeFileSync(
      path.join(dir, 'sets', 'memo', 'memo.schema.yaml'),
      'schema: 1\nkeys:\n  x: { type: bogus }\n',
    )
    const f = note('---\ntitle: A\nsubtitle: B\n---\n')
    const r = await run([f, '--json'])
    expect(r.err).toContain('Das Schema des Sets memo ist fehlerhaft')
    expect(() => JSON.parse(r.out)).not.toThrow()
  })
  it('an unresolved profile is an error (note folder searched)', async () => {
    const f = note('---\ntitle: A\nsubtitle: B\nprofile: nope\n---\n')
    expect((await run([f])).code).toBe(1)
    mkdirSync(path.join(dir, 'profiles'))
    writeFileSync(path.join(dir, 'profiles', 'nope.yaml'), '')
    expect((await run([f])).code).toBe(0)
  })
  it('MDO_TEMPLATES (relative to cwd) supplies user sets', async () => {
    mkdirSync(path.join(dir, 'user', 'mine'), { recursive: true })
    writeFileSync(path.join(dir, 'user', 'mine', 'mine.typ'), '')
    const f = note('---\ntitle: A\ntemplate: mine\n---\n')
    expect((await run([f])).code).toBe(0)
    expect((await run([note('---\ntemplate: nothere\n---\n', 'o.md')])).code).toBe(1)
  })
})

describe('validate: --fix / --add-missing', () => {
  const bom = '﻿'
  const crlf = `${bom}---\r\ntitle: A\r\nsubtitle: B\r\ndate: 2026-1-5\r\ntoc: Yes\r\n---\r\nBody\r\n`

  it('fixes preselected findings, keeps BOM, CRLF and untouched bytes, leaves no temp file', async () => {
    const f = note(crlf)
    const r = await run([f, '--fix'])
    const after = readFileSync(f, 'utf8')
    expect(after).toBe(
      `${bom}---\r\ntitle: A\r\nsubtitle: B\r\ndate: 2026-01-05\r\ntoc: true\r\n---\r\nBody\r\n`,
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain('2 Korrekturen geschrieben.')
    expect(readdirSync(dir).filter((n) => n.includes('mdo-tmp'))).toEqual([])
  })
  it('without --fix the file stays untouched', async () => {
    const f = note(crlf)
    await run([f])
    expect(readFileSync(f, 'utf8')).toBe(crlf)
  })
  it('--add-missing inserts the missing keys at the closing fence only', async () => {
    const f = note('---\r\ntitle: A\r\n---\r\nBody\r\n')
    const r = await run([f, '--add-missing', '--json'])
    expect(readFileSync(f, 'utf8')).toBe(
      '---\r\ntitle: A\r\ntemplate: memo\r\nsubtitle:\r\n---\r\nBody\r\n',
    )
    expect(JSON.parse(r.out).missing).toEqual([])
  })
  // Editor parity: the write goes through the link to its target, the link stays a link.
  it('--fix writes through a symlinked note', async () => {
    mkdirSync(path.join(dir, 'real'))
    const target = note('---\ntitle: A\ntoc: Yes\n---\n', 'real/t.md')
    const link = path.join(dir, 'link.md')
    symlinkSync(target, link)
    const r = await run([link, '--fix'])
    expect(r.code).toBe(0)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('---\ntitle: A\ntoc: true\n---\n')
    expect(readdirSync(dir).filter((n) => n.includes('mdo-tmp'))).toEqual([])
    expect(readdirSync(path.join(dir, 'real'))).toEqual(['t.md'])
  })
  it('the exit code reflects the re-validated result', async () => {
    const f = note('---\ntitle: A\nsubtitle: B\ndate: 31.04.2026\n---\n')
    expect((await run([f, '--fix'])).code).toBe(1)
  })
})
