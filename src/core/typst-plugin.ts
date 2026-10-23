/**
 * A host for Typst plugins (WebAssembly modules speaking Typst's wasm-minimal-protocol), so the
 * preview can run the very plugins the PDF export runs (mmdr for Mermaid) outside Typst: same
 * wasm, same arguments, same output.
 *
 * Protocol: the host calls an export with the byte lengths of its arguments; the plugin
 * allocates and asks for them through `wasm_minimal_protocol_write_args_to_buffer(ptr)`, where
 * the host copies all arguments back to back. The plugin hands its result over with
 * `wasm_minimal_protocol_send_result_to_host(ptr, len)`; the export returns 0 (result = output)
 * or 1 (result = error message).
 *
 * Only the WebAssembly global, no imports: src/core runs in the renderer, the CLI and Node's
 * type stripping (pipeline/tests/mermaid-core.mts) alike.
 */

export interface TypstPlugin {
  /** Calls the export `name`; returns its output bytes or throws its error message. */
  call(name: string, ...args: Uint8Array[]): Uint8Array
}

/** Instantiates the plugin `bytes` (a `.wasm` file's content). */
export async function loadTypstPlugin(bytes: Uint8Array): Promise<TypstPlugin> {
  let args: Uint8Array[] = []
  let result: Uint8Array | null = null
  let memory: WebAssembly.Memory | null = null
  const view = () => {
    if (!memory) throw new Error('Typst plugin: memory is not ready')
    // A fresh view every time: memory.grow() inside the plugin detaches older buffers.
    return new Uint8Array(memory.buffer)
  }
  const { instance } = await WebAssembly.instantiate(bytes as Uint8Array<ArrayBuffer>, {
    typst_env: {
      wasm_minimal_protocol_write_args_to_buffer(ptr: number) {
        const u8 = view()
        let offset = ptr
        for (const arg of args) {
          u8.set(arg, offset)
          offset += arg.length
        }
      },
      wasm_minimal_protocol_send_result_to_host(ptr: number, len: number) {
        // Copied out: the plugin may free or reuse that memory on the next call.
        result = view().slice(ptr, ptr + len)
      },
    },
  })
  memory = instance.exports.memory as WebAssembly.Memory
  const decoder = new TextDecoder()
  return {
    call(name, ...input) {
      const fn = instance.exports[name]
      if (typeof fn !== 'function') throw new Error(`Typst plugin has no function ${name}`)
      args = input
      result = null
      try {
        const code = (fn as (...lengths: number[]) => number)(...input.map((a) => a.length))
        const out = result ?? new Uint8Array()
        if (code !== 0) throw new Error(decoder.decode(out))
        return out
      } finally {
        // Release the caller's buffers; the next call sets its own.
        args = []
        result = null
      }
    },
  }
}
