import { promises as fs } from 'node:fs'
import { protocol } from 'electron'
import { fontFileFor } from './fonts'

export const FONT_SCHEME = 'mdo-font'

/** Must run before the app is ready. */
export function registerFontScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FONT_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ])
}

/** Serves only whitelisted font files from `dir`. */
export function handleFontProtocol(dir: string): void {
  protocol.handle(FONT_SCHEME, async (request) => {
    const file = fontFileFor(dir, new URL(request.url).pathname)
    if (!file) return new Response('not found', { status: 404 })
    try {
      const data = await fs.readFile(file)
      const type = file.endsWith('.ttf') ? 'font/ttf' : 'font/otf'
      return new Response(data, {
        headers: { 'content-type': type, 'access-control-allow-origin': '*' },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
