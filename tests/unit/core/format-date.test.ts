import { describe, expect, it } from 'vitest'
import { formatDate } from '../../../src/core/format-date'

describe('formatDate', () => {
  it.each([
    ['2026-10-14', 'de', '14. Oktober 2026'],
    ['3.1.2026', 'de', '3. Januar 2026'],
    ['2026-10-14', 'en', 'October 14, 2026'],
    ['14.10.2026, 9:30 Uhr', 'de', '14.10.2026, 9:30 Uhr'],
    ['2026-13-01', 'de', '2026-13-01'],
    ['', 'de', ''],
  ])('%j (%s) → %j', (raw, lang, out) => expect(formatDate(raw, lang)).toBe(out))
})
