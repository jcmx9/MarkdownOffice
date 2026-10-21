import { describe, expect, it } from 'vitest'
import { PIPELINE_SCHEMA } from '../../../src/core/frontmatter-schema'
import { validationContext } from '../../../src/core/validation-context'

const base = { set: 'memo', sets: ['memo'], header: null, schemaText: null, profile: null }

describe('validationContext', () => {
  it('uses the pipeline schema alone without a set schema', () => {
    const { ctx, schemaError } = validationContext(base)
    expect(schemaError).toBeNull()
    expect(ctx.schema).toEqual(PIPELINE_SCHEMA)
    expect(ctx.sets).toEqual(['memo'])
  })

  it('combines a valid set schema with the pipeline layer', () => {
    const text = 'schema: 1\nkeys:\n  x-extra:\n    type: text\n'
    const { ctx, schemaError } = validationContext({ ...base, schemaText: text })
    expect(schemaError).toBeNull()
    expect(Object.keys(ctx.schema.keys)).toContain('x-extra')
    expect(Object.keys(ctx.schema.keys)).toContain('title')
  })

  it('falls back to the pipeline schema and reports a broken set schema', () => {
    const { ctx, schemaError } = validationContext({
      ...base,
      schemaText: 'schema: 1\nkeys:\n  a:\n    type: nope\n',
    })
    expect(schemaError).toEqual(expect.any(String))
    expect(schemaError).not.toBe('')
    expect(ctx.schema).toEqual(PIPELINE_SCHEMA)
  })

  it('passes header and profile through', () => {
    const { ctx } = validationContext({ ...base, header: 'h', profile: { status: 'found' } })
    expect(ctx.header).toBe('h')
    expect(ctx.profile).toEqual({ status: 'found' })
  })
})
