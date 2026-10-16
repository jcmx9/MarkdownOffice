import { describe, expect, it } from 'vitest'
import { FONT_FILES } from '../../../src/main/fonts'
import { FONT_FACES, fontUrl } from '../../../src/renderer/ui/fonts'

describe('fontUrl', () => {
  it('percent-encodes the file name into the mdo-font URL', () => {
    expect(fontUrl('NotoEmoji[wght].ttf')).toBe('mdo-font://fonts/NotoEmoji%5Bwght%5D.ttf')
  })
})

describe('FONT_FACES', () => {
  it('lists exactly the files the main process serves', () => {
    const files = FONT_FACES.map((f) => f.file).sort()
    expect(files).toEqual([...FONT_FILES].sort())
  })
})
