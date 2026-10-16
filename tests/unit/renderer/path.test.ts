import { describe, expect, it } from 'vitest'
import { fileName } from '../../../src/renderer/util/path'

describe('fileName', () => {
  it.each([
    ['/a/b/c.md', 'c.md'],
    ['C:\\a\\b c.md', 'b c.md'],
    ['c.md', 'c.md'],
  ])('%s → %s', (p, n) => expect(fileName(p)).toBe(n))
})
