/** Longer targets are refused: no legitimate link in a note needs more. */
const MAX_URL = 4096

/**
 * The URL a link click may hand to the OS (shell.openExternal), or null. Only web pages
 * (http/https with a host) and mail (mailto); never file:, javascript:, custom app schemes or
 * anything with whitespace or control characters, whatever the renderer sends.
 */
export function externalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_URL) return null
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are the point
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol === 'mailto:') return url.href
  if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) return url.href
  return null
}
