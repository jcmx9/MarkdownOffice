import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bashFor } from '../../../scripts/dev-layout.mjs'

describe('bashFor', () => {
  it('uses bash from PATH on macOS and Linux', () => {
    expect(bashFor('darwin', {}, () => true)).toBe('bash')
    expect(bashFor('linux', { ProgramFiles: '/x' }, () => true)).toBe('bash')
  })

  it("prefers Git for Windows' bash over whatever cmd.exe finds", () => {
    const git = join('C:\\Program Files', 'Git', 'bin', 'bash.exe')
    expect(bashFor('win32', { ProgramFiles: 'C:\\Program Files' }, (p) => p === git)).toBe(git)
  })

  it('falls back to bash from PATH when Git for Windows is missing', () => {
    expect(bashFor('win32', { ProgramFiles: 'C:\\Program Files' }, () => false)).toBe('bash')
  })
})
