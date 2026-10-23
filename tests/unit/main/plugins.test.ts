import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pluginWasm } from '../../../src/main/plugins'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mdo-plugins-'))
  await mkdir(join(root, 'vendor', 'mmdr'), { recursive: true })
  await writeFile(join(root, 'vendor', 'mmdr', 'typst_mmdr.wasm'), Buffer.from([0, 97, 115, 109]))
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('pluginWasm', () => {
  it('returns the bytes of a known plugin', async () => {
    expect([...(await pluginWasm(root, 'mmdr'))]).toEqual([0, 97, 115, 109])
  })

  it.each(['../etc/passwd', 'vendor/mmdr/typst_mmdr.wasm', '', 'toString', '__proto__', 7, null])(
    'rejects the unknown name %j and never builds a path from it',
    async (name) => {
      await expect(pluginWasm(root, name)).rejects.toThrow('Unbekanntes Plugin')
    },
  )

  it('rejects with a clear error when the file is missing, and retries later', async () => {
    await expect(pluginWasm(root, 'mitex')).rejects.toThrow(/Plugin „mitex“ nicht lesbar/)
    await mkdir(join(root, 'vendor', 'mitex'), { recursive: true })
    await writeFile(join(root, 'vendor', 'mitex', 'mitex.wasm'), Buffer.from([1]))
    expect([...(await pluginWasm(root, 'mitex'))]).toEqual([1])
  })

  it('reads a file once', async () => {
    const first = await pluginWasm(root, 'mmdr')
    await writeFile(join(root, 'vendor', 'mmdr', 'typst_mmdr.wasm'), Buffer.from([9]))
    expect(await pluginWasm(root, 'mmdr')).toBe(first)
  })
})

describe('renderer CSP', () => {
  const html = readFileSync(join(__dirname, '../../../src/renderer/index.html'), 'utf8')
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''
  const directive = (n: string) =>
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${n} `))

  it('allows WebAssembly compilation in script-src only', () => {
    expect(directive('script-src')).toBe("script-src 'self' 'wasm-unsafe-eval'")
    expect(csp).not.toMatch(/(?<!wasm-)unsafe-eval/)
    expect(directive('default-src')).toBe("default-src 'self'")
    expect(directive('style-src')).toBe("style-src 'self' 'unsafe-inline'")
    expect(directive('img-src')).toBe("img-src 'self' data:")
  })
})
