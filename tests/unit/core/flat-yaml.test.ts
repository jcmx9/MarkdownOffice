import { describe, expect, it } from 'vitest'
import { flattenProfile, readFlatYaml } from '../../../src/core/flat-yaml'
import { isoDate } from '../../../src/core/format-date'

describe('readFlatYaml', () => {
  it('reads scalars as source text', () =>
    expect(readFlatYaml('zip: 01067\nphone: "+49 89"\nname: A # c\nn: ~\n')).toEqual({
      zip: '01067',
      phone: '+49 89',
      name: 'A',
      n: '',
    }))
  it('reads block and flow lists', () =>
    expect(readFlatYaml('x-to:\n  - Firma\n  - "12345 Ort"\nx-att: ["A, B", C]\ne: []\n')).toEqual({
      'x-to': ['Firma', '12345 Ort'],
      'x-att': ['A, B', 'C'],
      e: [],
    }))
  it('reads block scalars', () =>
    expect(readFlatYaml('a: |\n  L1\n  L2\nb: x\n')).toEqual({ a: 'L1\nL2', b: 'x' }))
  it('folds > scalars and drops trailing blank lines', () =>
    expect(readFlatYaml('a: >-\n  L1\n  L2\n\nb: x\n')).toEqual({ a: 'L1 L2', b: 'x' }))
  it('ignores nested keys, keeps the last duplicate, strips CR', () =>
    expect(readFlatYaml('m:\r\n  k: v\r\nt: 1\r\nt: 2\r\n')).toEqual({ m: '', t: '2' }))
})

describe('flattenProfile', () => {
  it('joins profile lists', () =>
    expect(flattenProfile({ a: ['x', 'y'], b: 'z' })).toEqual({ a: 'x, y', b: 'z' }))
})

describe('isoDate', () => {
  it('is local', () => expect(isoDate(new Date(2026, 9, 2))).toBe('2026-10-02'))
})
