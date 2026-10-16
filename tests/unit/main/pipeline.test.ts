import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type PipelinePaths,
  parseTypstVersion,
  pipelinePaths,
  runPipeline,
  typstVersion,
} from '../../../src/main/pipeline'
import { makeFakeCli } from '../../helpers/fake-cli'

let dir: string
let note: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mdo-pipeline-'))
  note = join(dir, 'Notiz mit Leerzeichen.md')
  await writeFile(note, '# Test\n')
})

const fakePaths = (cli: string): PipelinePaths => ({
  root: join(dir, 'pipeline root'),
  sets: join(dir, 'sets dir'),
  cli,
  fonts: join(dir, 'pipeline root', 'fonts'),
})

const record = async (file: string) =>
  JSON.parse(await readFile(file, 'utf8')) as {
    args: string[]
    cwd: string
    env: Record<string, string>
  }

describe('pipelinePaths', () => {
  it('uses <resources>/pipeline and <resources>/sets when packaged', () => {
    const res = resolve('/Apps/Markdown Office.app/Contents/Resources')
    expect(pipelinePaths(true, res, resolve('/ignored'))).toEqual({
      root: join(res, 'pipeline'),
      sets: join(res, 'sets'),
      cli: join(res, 'pipeline', 'cli.js'),
      fonts: join(res, 'pipeline', 'fonts'),
    })
  })

  it('uses the dev layout below build/pipeline-dev in development', () => {
    const repo = resolve('/src/Markdown Office')
    const root = join(repo, 'build', 'pipeline-dev', 'pipeline')
    expect(pipelinePaths(false, resolve('/ignored'), repo)).toEqual({
      root,
      sets: join(repo, 'build', 'pipeline-dev', 'sets'),
      cli: join(root, 'cli.js'),
      fonts: join(root, 'fonts'),
    })
  })
})

describe('runPipeline', () => {
  it('runs cli.js with the note as one argument and returns the last stdout line', async () => {
    const { cli, recordFile } = await makeFakeCli(dir, { stdout: 'Info\nOK erzeugt' })
    const paths = fakePaths(cli)
    expect(await runPipeline(note, { paths, version: '26.10.0' })).toEqual({
      kind: 'ok',
      message: 'OK erzeugt',
    })
    const r = await record(recordFile)
    expect(r.args).toEqual([note])
    expect(await realDir(r.cwd)).toBe(await realDir(dir))
    expect(r.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      MDO_PIPELINE_ROOT: paths.root,
      MDO_SETS_DIR: paths.sets,
      MDO_VERSION: '26.10.0',
    })
  })

  it('returns the exit code and stderr on failure', async () => {
    const { cli, recordFile } = await makeFakeCli(dir, {
      stdout: 'Teil',
      stderr: 'Error: Vorlage nicht gefunden',
      code: 4,
    })
    expect(await runPipeline(note, { paths: fakePaths(cli), version: 'dev' })).toEqual({
      kind: 'failed',
      code: 4,
      stderr: 'Error: Vorlage nicht gefunden',
    })
    expect((await record(recordFile)).args).toEqual([note])
  })

  it('explains a failure without stderr', async () => {
    const { cli } = await makeFakeCli(dir, { code: 2 })
    expect(await runPipeline(note, { paths: fakePaths(cli), version: 'dev' })).toEqual({
      kind: 'failed',
      code: 2,
      stderr: 'Export endete mit Code 2.',
    })
  })

  it('reports a runtime that cannot start', async () => {
    const { cli } = await makeFakeCli(dir)
    const r = await runPipeline(note, {
      paths: fakePaths(cli),
      version: 'dev',
      execPath: join(dir, 'gibt-es-nicht'),
    })
    expect(r).toMatchObject({ kind: 'failed', code: null })
    if (r.kind === 'failed') expect(r.stderr).toMatch(/^Export konnte nicht gestartet werden: /)
  })

  it('kills a hanging export after the timeout', async () => {
    const { cli } = await makeFakeCli(dir, { sleepSeconds: 5 })
    const started = Date.now()
    const r = await runPipeline(note, { paths: fakePaths(cli), version: 'dev', timeoutMs: 300 })
    expect(r.kind).toBe('failed')
    if (r.kind === 'failed') expect(r.stderr).toMatch(/Zeitüberschreitung/)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('passes umlauts and spaces in the path unchanged', async () => {
    const umlaut = join(dir, 'Übergabe Grüße.md')
    await writeFile(umlaut, '# Ü\n')
    const { cli, recordFile } = await makeFakeCli(dir, { stdout: 'OK' })
    await runPipeline(umlaut, { paths: fakePaths(cli), version: 'dev' })
    expect((await record(recordFile)).args).toEqual([umlaut])
  })
})

describe('typstVersion', () => {
  it.skipIf(process.platform === 'win32')(
    'runs <root>/bin/typst --version and returns the version',
    async () => {
      const root = join(dir, 'pipeline')
      await mkdir(join(root, 'bin'), { recursive: true })
      const typst = join(root, 'bin', 'typst')
      await writeFile(typst, '#!/bin/sh\necho "typst 0.15.0 (3ae52774)"\n')
      await chmod(typst, 0o755)
      expect(await typstVersion(root)).toBe('0.15.0')
    },
  )

  it('is null when the binary is missing', async () => {
    expect(await typstVersion(join(dir, 'leer'))).toBeNull()
  })
})

describe('parseTypstVersion', () => {
  it.each([
    ['typst 0.15.0 (3ae52774)', '0.15.0'],
    ['\r\ntypst 0.14.2-rc1\r\n', '0.14.2-rc1'],
    ['irgendwas', 'irgendwas'],
    ['', null],
  ])('%j → %s', (out, version) => {
    expect(parseTypstVersion(out)).toBe(version)
  })
})

async function realDir(p: string): Promise<string> {
  const { realpath } = await import('node:fs/promises')
  return realpath(p)
}
