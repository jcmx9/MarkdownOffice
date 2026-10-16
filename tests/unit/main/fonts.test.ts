import path, { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FONT_FILES, fontFileFor } from '../../../src/main/fonts'

describe('fontFileFor', () => {
  const dir = path.resolve('/fonts')
  it('maps a whitelisted, URI-encoded name into the font folder', () => {
    expect(fontFileFor(dir, '/SourceSans3VF-Upright.otf')).toBe(
      join(dir, 'SourceSans3VF-Upright.otf'),
    )
    expect(fontFileFor(dir, '/NotoEmoji%5Bwght%5D.ttf')).toBe(join(dir, 'NotoEmoji[wght].ttf'))
  })
  it.each([
    '/../secret.otf',
    '/%2E%2E%2Fsecret.otf',
    '/evil.otf',
    '/',
    '/fonts/SourceSans3VF-Upright.otf',
    '/%E0%A4%A',
  ])('rejects %s', (p) => expect(fontFileFor(dir, p)).toBeNull())
})

describe('FONT_FILES', () => {
  it('lists every bundled font the editor registers', () => {
    expect(FONT_FILES).toEqual(
      expect.arrayContaining([
        'SourceSans3VF-Upright.otf',
        'SourceSerif4Variable-Roman.otf',
        'SourceCodeVF-Upright.otf',
        'NotoEmoji[wght].ttf',
        'NotoSansSymbols2-Regular.ttf',
      ]),
    )
  })
})
