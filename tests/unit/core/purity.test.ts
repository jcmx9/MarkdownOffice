import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// src/core/ is shared by the app, the CLI bundle and a later MCP server, so it must stay free of
// Electron, DOM and node:* imports; those belong to the callers.
const CORE = join(__dirname, '../../../src/core')

function tsFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? tsFiles(join(dir, e.name))
        : e.name.endsWith('.ts')
          ? [join(dir, e.name)]
          : [],
    )
  } catch {
    return []
  }
}

describe('src/core purity', () => {
  const files = tsFiles(CORE)
  it('contains modules', () => {
    expect(files.length).toBeGreaterThan(0)
  })
  it.each(files)('%s has no electron, node:, require or DOM usage', (file) => {
    const src = readFileSync(file, 'utf8')
    expect(src).not.toMatch(/from ['"]electron['"]/)
    expect(src).not.toMatch(/from ['"]node:/)
    expect(src).not.toMatch(/\b(document|window)\./)
    expect(src).not.toMatch(/\brequire\(/)
    expect(src).not.toMatch(/\bglobalThis\.(document|window)\b/)
    // A bare `import 'x'` runs code for its side effect; a `?raw` import has a binding and is fine.
    expect(src).not.toMatch(/^import ['"]/m)
  })
})
