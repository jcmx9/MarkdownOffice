import { cp, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { previewInputs } from '../../../src/main/preview-inputs'
import { findProfile } from '../../../src/main/validation-inputs'

const FIXTURES = resolve(__dirname, '../../fixtures/sets')

let root: string
let sets: string
let user: string
let noteDir: string

const run = (template: string, profile = '') =>
  previewInputs({ setsDir: sets, userDir: user, noteDir, template, profile })

const fxProfile = () => join(user, 'fx-brief', 'profiles', 'fx.yaml')

async function put(path: string, text: string | Buffer = ''): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'mdo-prvin-')))
  sets = join(root, 'sets')
  user = join(root, 'Vorlagen')
  noteDir = join(root, 'notiz')
  await mkdir(noteDir, { recursive: true })
  await put(join(sets, 'memo', 'memo.typ'))
  await cp(join(FIXTURES, 'fx-brief'), join(user, 'fx-brief'), { recursive: true })
})

describe('previewInputs', () => {
  it('reads css, description, profile and signature of a user set', async () => {
    const r = await run('fx-brief', 'fx')
    expect(r.set).toBe('fx-brief')
    expect(r.css[0]?.declarations).toContainEqual([
      '--mdo-measure',
      'calc(165mm * var(--mdo-scale, 1))',
    ])
    expect(r.preview).toContain('preview: 1')
    expect(r.profile).toMatchObject({
      name: 'Dr. Erika Muster',
      zip: '01067',
      'signature-width': '40mm',
    })
    expect(r.signature).toMatch(/^data:image\/svg\+xml;base64,/)
    const svg = Buffer.from((r.signature as string).split(',')[1] as string, 'base64').toString()
    expect(svg).toContain('<path d="M5 25')
  })

  it('memo for an empty template; built-in for .typ and unknown sets', async () => {
    const memo = await run('')
    expect(memo).toEqual({ set: 'memo', css: [], preview: null, profile: {}, signature: null })
    const none = { set: '', css: [], preview: null, profile: {}, signature: null }
    expect(await run('/x/a.typ', 'fx')).toEqual(none)
    expect(await run('nope', 'fx')).toEqual(none)
  })

  it.each(['../x.svg', '/abs/x.svg', 'x.svg.png', '.hidden.svg'])(
    'refuses signature %s',
    async (name) => {
      await put(join(user, 'fx-brief', 'x.svg'), '<svg/>')
      await put(join(user, 'fx-brief', 'profiles', '.hidden.svg'), '<svg/>')
      await put(fxProfile(), `name: Dr. Erika Muster\nsignature: ${name}\n`)
      const r = await run('fx-brief', 'fx')
      expect(r.profile.name).toBe('Dr. Erika Muster')
      expect(r.signature).toBeNull()
    },
  )

  it('refuses a signature over 256 KiB', async () => {
    const big = `<svg>${' '.repeat(256 * 1024)}</svg>`
    await put(join(user, 'fx-brief', 'profiles', 'fx-unterschrift.svg'), big)
    expect((await run('fx-brief', 'fx')).signature).toBeNull()
  })

  it('returns {} and no signature without a profile', async () => {
    for (const p of ['', 'fehlt', 'Ungueltig']) {
      const r = await run('fx-brief', p)
      expect(r.profile).toEqual({})
      expect(r.signature).toBeNull()
    }
  })

  it('findProfile returns the winning path', async () => {
    const found = await findProfile('fx', {
      userDir: user,
      noteDir,
      set: 'fx-brief',
      setDir: join(user, 'fx-brief'),
    })
    expect(found).toEqual({ status: 'found', path: fxProfile() })
  })
})
