import { describe, expect, it } from 'vitest'
import { Ch } from '../../../src/shared/ipc'

describe('IPC channels', () => {
  it('are unique and namespaced', () => {
    const values = Object.values(Ch)
    expect(new Set(values).size).toBe(values.length)
    for (const v of values) expect(v).toMatch(/^mdo:[a-z-]+$/)
  })

  it('offer the template-set channels instead of the old memo-only header channel', () => {
    expect(Ch).toMatchObject({
      listSets: 'mdo:list-sets',
      readSetHeader: 'mdo:read-set-header',
      listProfiles: 'mdo:list-profiles',
    })
    expect(Object.values(Ch)).not.toContain('mdo:read-header-template')
  })
})
