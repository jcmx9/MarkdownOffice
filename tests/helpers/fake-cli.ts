import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface FakeCliOptions {
  stdout?: string
  stderr?: string
  code?: number
  sleepSeconds?: number
}

/**
 * Writes a stand-in for the bundled <resources>/pipeline/cli.js (src/cli/). It records its
 * arguments, its working directory and the MDO_* / ELECTRON_RUN_AS_NODE environment as JSON in
 * `record.json`, then prints and exits as told.
 */
export async function makeFakeCli(
  dir: string,
  o: FakeCliOptions = {},
): Promise<{ cli: string; recordFile: string }> {
  const cli = join(dir, 'cli.js')
  const recordFile = join(dir, 'record.json')
  const source = `'use strict'
const fs = require('node:fs')
const env = {}
for (const k of Object.keys(process.env)) {
  if (k.startsWith('MDO_') || k === 'ELECTRON_RUN_AS_NODE') env[k] = process.env[k]
}
fs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), env }))
const finish = () => {
  ${o.stdout ? `process.stdout.write(${JSON.stringify(`${o.stdout}\n`)})` : ''}
  ${o.stderr ? `process.stderr.write(${JSON.stringify(`${o.stderr}\n`)})` : ''}
  process.exitCode = ${o.code ?? 0}
}
${o.sleepSeconds ? `setTimeout(finish, ${o.sleepSeconds * 1000})` : 'finish()'}
`
  await writeFile(cli, source)
  return { cli, recordFile }
}
