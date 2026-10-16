import { describe, expect, it } from 'vitest'
import { Ch } from '../../../src/shared/ipc'

describe('IPC channels', () => {
  it('are unique and namespaced', () => {
    const values = Object.values(Ch)
    expect(new Set(values).size).toBe(values.length)
    for (const v of values) expect(v).toMatch(/^mdo:[a-z-]+$/)
  })
})
