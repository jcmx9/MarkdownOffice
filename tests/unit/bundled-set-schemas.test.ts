import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSchema } from '../../src/core/frontmatter-schema'
import { errorCount, validateFrontmatter } from '../../src/core/frontmatter-validate'
import { validationContext } from '../../src/core/validation-context'

// A set's `<name>.schema.yaml` must parse, and the set's own header template (what a new note
// starts from) must pass its own schema without errors. Checked against the fetched sets
// (npm run assets); sets without a schema (older pins) are skipped.
const setsDir = join(__dirname, '..', '..', 'build', 'pipeline-assets', 'sets')
const sets = existsSync(setsDir)
  ? readdirSync(setsDir).filter((n) => statSync(join(setsDir, n)).isDirectory())
  : []
const withSchema = sets.filter((n) => existsSync(join(setsDir, n, `${n}.schema.yaml`)))
const skip = withSchema.length > 0 ? false : `no set schemas in ${setsDir} – run npm run assets`

describe('bundled set schemas', () => {
  it.skipIf(skip).each(withSchema)('%s: schema parses and accepts its own header', async (name) => {
    const dir = join(setsDir, name)
    const schemaText = await readFile(join(dir, `${name}.schema.yaml`), 'utf8')
    const loaded = parseSchema(schemaText)
    expect(loaded.ok).toBe(true)
    const header = existsSync(join(dir, `${name}.header.md`))
      ? await readFile(join(dir, `${name}.header.md`), 'utf8')
      : null
    const { ctx, schemaError } = validationContext({
      set: name,
      sets,
      header,
      schemaText,
      profile: { status: 'found' },
    })
    expect(schemaError).toBeNull()
    if (header === null) return
    expect(errorCount(validateFrontmatter(header, ctx))).toBe(0)
  })
  // memo splits the region off `lang` before text(lang:), so regional codes must stay valid.
  it.skipIf(!withSchema.includes('memo'))(
    'memo accepts a regional lang such as de-AT',
    async () => {
      const dir = join(setsDir, 'memo')
      const header = (await readFile(join(dir, 'memo.header.md'), 'utf8')).replace(
        /^lang:.*$/m,
        'lang: de-AT',
      )
      const { ctx } = validationContext({
        set: 'memo',
        sets,
        header,
        schemaText: await readFile(join(dir, 'memo.schema.yaml'), 'utf8'),
        profile: { status: 'found' },
      })
      expect(header).toContain('lang: de-AT')
      expect(errorCount(validateFrontmatter(header, ctx))).toBe(0)
    },
  )
  if (skip) it.skip(skip, () => undefined)
})
