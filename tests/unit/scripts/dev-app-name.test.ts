import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyAppName, codesignArgs, plutilArgs } from '../../../scripts/dev-app-name.mjs'

describe('plutilArgs', () => {
  it('replaces CFBundleName and CFBundleDisplayName', () => {
    expect(plutilArgs('Markdown Office', '/x/Info.plist')).toEqual([
      ['-replace', 'CFBundleName', '-string', 'Markdown Office', '/x/Info.plist'],
      ['-replace', 'CFBundleDisplayName', '-string', 'Markdown Office', '/x/Info.plist'],
    ])
  })
})

describe('codesignArgs', () => {
  it('re-signs the bundle ad hoc, since the Info.plist hash is part of the signature', () => {
    expect(codesignArgs('/x/Electron.app')).toEqual(['--force', '--sign', '-', '/x/Electron.app'])
  })
})

describe.skipIf(process.platform !== 'darwin')('applyAppName (macOS)', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('patches a temp Info.plist and is idempotent', () => {
    dir = mkdtempSync(join(tmpdir(), 'mdo-plist-'))
    const bundle = join(dir, 'Electron.app')
    mkdirSync(join(bundle, 'Contents'), { recursive: true })
    const plist = join(bundle, 'Contents', 'Info.plist')
    copyFileSync('/System/Applications/TextEdit.app/Contents/Info.plist', plist)
    const read = (key: string) =>
      execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', plist]).toString().trim()

    applyAppName('Markdown Office', plist, bundle)
    applyAppName('Markdown Office', plist, bundle)

    expect(read('CFBundleName')).toBe('Markdown Office')
    expect(read('CFBundleDisplayName')).toBe('Markdown Office')
  })
})
