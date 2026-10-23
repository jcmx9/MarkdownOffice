import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTypstPlugin, TypstPluginError } from '../../../src/core/typst-plugin'

// The real plugin the PDF export runs (fetched by npm run assets); no stand-in, so the host is
// checked against the protocol mmdr actually speaks.
const WASM = join(__dirname, '../../../build/pipeline-assets/vendor/mmdr/typst_mmdr.wasm')
const skip = existsSync(WASM) ? false : `${WASM} missing – run npm run assets`
const enc = new TextEncoder()
const dec = new TextDecoder()
const load = () => loadTypstPlugin(new Uint8Array(readFileSync(WASM)))

describe.skipIf(skip)('loadTypstPlugin (mmdr)', () => {
  it('runs render and returns the SVG bytes', async () => {
    const plugin = await load()
    const out = plugin.call(
      'render',
      enc.encode('flowchart LR\n  A[Start] --> B[Ende]'),
      enc.encode('modern'),
      new Uint8Array(),
      new Uint8Array(),
    )
    const svg = dec.decode(out)
    expect(svg).toMatch(/^<svg/)
    expect(svg).toContain('Start')
    expect(svg).toContain('Ende')
  })

  it('throws the plugin message on an error result', async () => {
    const plugin = await load()
    // A theme override that is not JSON makes render return 1 with a message.
    expect(() =>
      plugin.call(
        'render',
        enc.encode('flowchart LR\n  A --> B'),
        enc.encode('modern'),
        enc.encode('{not json'),
        new Uint8Array(),
      ),
    ).toThrow(/\S/)
  })

  it("marks the error result as the plugin's own error (the instance stays usable)", async () => {
    const plugin = await load()
    // Callers tell a reported error (keep the instance) from a trap (drop it) by this class.
    let error: unknown
    try {
      plugin.call(
        'render',
        enc.encode('x'),
        enc.encode('modern'),
        enc.encode('{'),
        new Uint8Array(),
      )
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(TypstPluginError)
  })

  it('throws for an export the plugin does not have', async () => {
    const plugin = await load()
    expect(() => plugin.call('nope')).toThrow(/nope/)
  })

  it('stays usable after an error and across many calls', async () => {
    const plugin = await load()
    expect(() =>
      plugin.call(
        'render',
        enc.encode('x'),
        enc.encode('modern'),
        enc.encode('{'),
        new Uint8Array(),
      ),
    ).toThrow()
    const args = [
      enc.encode('flowchart TD\n  A --> B'),
      enc.encode('modern'),
      new Uint8Array(),
      new Uint8Array(),
    ]
    const first = dec.decode(plugin.call('render', ...args))
    for (let i = 0; i < 20; i++) expect(dec.decode(plugin.call('render', ...args))).toBe(first)
  })
})
