import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The pipeline's vendored WebAssembly plugins, by fixed name. The renderer only ever names one
 * of these keys; the path comes from this table, never from the request.
 */
const PLUGIN_FILES = {
  mmdr: ['vendor', 'mmdr', 'typst_mmdr.wasm'],
  mitex: ['vendor', 'mitex', 'mitex.wasm'],
} as const

export type PluginName = keyof typeof PLUGIN_FILES

const cache = new Map<string, Promise<Uint8Array>>()

/**
 * The bytes of a plugin from the pipeline root, read once and cached (the files are several
 * MB and the preview asks on every window). A failed read is not cached, so a later retry
 * can succeed.
 */
export function pluginWasm(root: string, name: unknown): Promise<Uint8Array> {
  if (typeof name !== 'string' || !Object.hasOwn(PLUGIN_FILES, name)) {
    return Promise.reject(new TypeError('Unbekanntes Plugin.'))
  }
  const file = join(root, ...PLUGIN_FILES[name as PluginName])
  let bytes = cache.get(file)
  if (!bytes) {
    bytes = readFile(file).then(
      (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
      (err: unknown) => {
        cache.delete(file)
        throw new Error(
          `Plugin „${name}“ nicht lesbar: ${err instanceof Error ? err.message : String(err)}`,
        )
      },
    )
    cache.set(file, bytes)
  }
  return bytes
}
