import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { headerProfile } from '../../src/shared/sets'

// TEMPLATES.md checklist: a set whose header names a `profile:` ships that profile as
// `profiles/<value>.yaml`. A new note from the set then exports right away, and „Profil
// anlegen …“ has an example to copy. Checked against the fetched sets (npm run assets).
const setsDir = join(__dirname, '..', '..', 'build', 'pipeline-assets', 'sets')
const sets = existsSync(setsDir)
  ? readdirSync(setsDir).filter((n) => statSync(join(setsDir, n)).isDirectory())
  : []
const skip = sets.length > 0 ? false : `no sets in ${setsDir} – run npm run assets`

describe('bundled sets', () => {
  it.skipIf(skip).each(sets)('%s ships the profile its header names', async (name) => {
    const header = join(setsDir, name, `${name}.header.md`)
    if (!existsSync(header)) return
    const profile = headerProfile(await readFile(header, 'utf8'))
    if (!profile) return
    expect(statSync(join(setsDir, name, 'profiles', `${profile}.yaml`)).isFile()).toBe(true)
  })
  if (skip) it.skip(skip, () => undefined)
})
