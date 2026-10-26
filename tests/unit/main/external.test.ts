import { describe, expect, it } from 'vitest'
import { externalUrl } from '../../../src/main/external'

describe('externalUrl', () => {
  it('passes web pages and mail', () => {
    expect(externalUrl('https://example.org/a?b=1#c')).toBe('https://example.org/a?b=1#c')
    expect(externalUrl('http://example.org')).toBe('http://example.org/')
    expect(externalUrl('mailto:a@b.de?subject=Hallo%20Welt')).toBe(
      'mailto:a@b.de?subject=Hallo%20Welt',
    )
  })

  it('refuses everything else', () => {
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ms-settings:privacy',
      'notiz.md',
      'https://',
      'https://exa mple.org',
      'https://example.org/\nx',
      `https://example.org/${'a'.repeat(5000)}`,
      42,
      null,
    ]) {
      expect(externalUrl(bad)).toBeNull()
    }
  })
})
