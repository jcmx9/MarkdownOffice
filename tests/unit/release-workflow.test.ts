import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load: (text: string) => unknown }

const root = resolve(__dirname, '../..')
const text = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')

interface Step {
  name?: string
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}
interface Job {
  needs?: string | string[]
  permissions?: Record<string, string>
  strategy?: { 'fail-fast'?: boolean; matrix: { os: string[] } }
  steps: Step[]
}
interface Workflow {
  on: { push: { tags: string[]; branches?: string[] } }
  permissions?: Record<string, string>
  jobs: Record<string, Job>
}

const wf = yaml.load(text) as Workflow

function job(name: string): Job {
  const j = wf.jobs[name]
  if (!j) throw new Error(`no job ${name}`)
  return j
}

function find(name: string, pred: (s: Step) => boolean): Step {
  const step = job(name).steps.find(pred)
  if (!step) throw new Error(`no matching step in ${name}`)
  return step
}

describe('release workflow', () => {
  it('runs only for v* tags', () => {
    expect(wf.on.push.tags).toEqual(['v*'])
    expect(wf.on.push.branches).toBeUndefined()
    expect(Object.keys(wf.on)).toEqual(['push'])
  })

  it('has verify -> build -> publish in order', () => {
    expect(Object.keys(wf.jobs)).toEqual(['verify', 'build', 'publish'])
    expect(job('verify').needs).toBeUndefined()
    expect(job('build').needs).toBe('verify')
    expect(job('publish').needs).toBe('build')
  })

  it('verifies that the tag equals v + package.json version', () => {
    const run = find('verify', (s) => !!s.run?.includes('package.json')).run ?? ''
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell expansion
    expect(run).toContain('v${version}')
    expect(run).toContain('exit 1')
  })

  it('builds on macOS, Windows and Linux with npm ci and npm run dist', () => {
    const { strategy } = job('build')
    expect(strategy?.matrix.os).toEqual(['macos-latest', 'windows-latest', 'ubuntu-latest'])
    expect(strategy?.['fail-fast']).toBe(false)
    expect(job('build').steps.some((s) => s.run === 'npm ci')).toBe(true)
    const dist = find('build', (s) => s.run === 'npm run dist')
    expect(dist.env?.CSC_FOR_PULL_REQUEST).toBe('true')
  })

  it('uploads only the archives, one artifact per OS', () => {
    const up = find('build', (s) => !!s.uses?.startsWith('actions/upload-artifact@'))
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
    expect(up.with?.name).toBe('dist-${{ matrix.os }}')
    expect(String(up.with?.path).split('\n').filter(Boolean)).toEqual([
      'dist/*.zip',
      'dist/*.AppImage',
    ])
    expect(up.with?.['if-no-files-found']).toBe('error')
  })

  it('writes SHA256SUMS in a format sha256sum -c accepts', () => {
    const run = find('publish', (s) => !!s.run?.includes('SHA256SUMS')).run ?? ''
    expect(run).toContain('sha256sum')
    expect(run).toContain('> SHA256SUMS')
    expect(run).toContain('sha256sum -c SHA256SUMS')
    expect(run).not.toContain('release/')
  })

  it('marks -dev. tags as pre-release and uploads archives plus checksums', () => {
    const rel = find('publish', (s) => !!s.uses?.startsWith('softprops/action-gh-release@'))
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
    expect(rel.with?.prerelease).toBe("${{ contains(github.ref_name, '-dev.') }}")
    expect(rel.with?.generate_release_notes).toBeUndefined()
    expect(rel.with?.body_path).toBe('release-notes.md')
    expect(String(rel.with?.files).split('\n').filter(Boolean)).toEqual([
      'release/*.zip',
      'release/*.AppImage',
      'release/SHA256SUMS',
    ])
  })

  it('takes the release notes from CHANGELOG.md, never from GitHub (no author lists)', () => {
    expect(text).not.toContain('generate_release_notes')
    const notes = find('publish', (s) => !!s.run?.includes('scripts/release-notes.sh'))
    expect(notes.run).toContain('> release-notes.md')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
    expect(notes.env?.TAG).toBe('${{ github.ref_name }}')
    const steps = job('publish').steps
    const checkout = steps.findIndex((s) => !!s.uses?.startsWith('actions/checkout@'))
    expect(checkout).toBeGreaterThanOrEqual(0)
    expect(checkout).toBeLessThan(steps.indexOf(notes))
  })

  it('grants contents: write only to the publish job', () => {
    expect(wf.permissions).toEqual({ contents: 'read' })
    expect(job('publish').permissions).toEqual({ contents: 'write' })
    expect(job('verify').permissions).toBeUndefined()
    expect(job('build').permissions).toBeUndefined()
  })

  it('pins every action to a full commit SHA with a version comment', () => {
    const uses = text.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l))
    expect(uses.length).toBeGreaterThanOrEqual(5)
    for (const line of uses) {
      expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/)
    }
  })
})
