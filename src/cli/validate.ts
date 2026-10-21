// `markdown-office validate <note.md> [--fix] [--add-missing] [--json]`: the YAML check of the
// editor (src/core/frontmatter-validate.ts) on the command line. Exit 0 = no errors (warnings and
// hints do not count), 1 = errors, 2 = usage or file error.
//
// Why raw bytes: the note is decoded strictly (a non-UTF-8 file is a usage error, never
// "repaired") with the BOM kept in the text, and written back through text changes that touch
// only their own lines, so BOM, CRLF and every other byte survive a --fix.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  errorCount,
  type Finding,
  noteSet,
  selectedChanges,
  topLevelValue,
  type ValidationResult,
  validateFrontmatter,
} from '../core/frontmatter-validate'
import { applyChanges } from '../core/header-merge'
import { findingMessage } from '../core/validate-messages'
import { validationContext } from '../core/validation-context'
import { userTemplatesDir } from '../main/templates'
import { validationInputs } from '../main/validation-inputs'
import type { Env } from './launch'

const USAGE = 'Aufruf: markdown-office validate <notiz.md> [--fix] [--add-missing] [--json]\n'
const LABEL = { error: 'Fehler', warning: 'Warnung', hint: 'Hinweis' } as const
// ignoreBOM keeps a leading BOM in the text; the validator knows it.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

interface Options {
  file: string
  fix: boolean
  addMissing: boolean
  json: boolean
}

function parseArgs(args: string[]): Options | null {
  const o: Options = { file: '', fix: false, addMissing: false, json: false }
  let files = 0
  for (const a of args) {
    if (a === '--fix') o.fix = true
    else if (a === '--add-missing') o.addMissing = true
    else if (a === '--json') o.json = true
    else if (a.startsWith('-')) return null
    else {
      o.file = a
      files++
    }
  }
  return files === 1 ? o : null
}

/** temp file in the same folder + rename; the original's permissions are kept. */
function writeAtomic(file: string, bytes: Uint8Array): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.mdo-tmp`)
  try {
    fs.writeFileSync(tmp, bytes, { mode: fs.statSync(file).mode & 0o777 })
    fs.renameSync(tmp, file)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

/** The inputs a note's check needs, from the same places the export uses. */
async function check(text: string, file: string, env: Env) {
  const root = env.MDO_PIPELINE_ROOT || path.dirname(path.resolve(process.argv[1] ?? file))
  const setsDir = env.MDO_SETS_DIR || path.join(root, '..', 'sets')
  const userDir = userTemplatesDir(env, path.join(os.homedir(), 'Documents'))
  const inputs = await validationInputs({
    setsDir,
    userDir,
    noteDir: path.dirname(path.resolve(file)),
    template: topLevelValue(text, 'template') ?? '',
    profile: topLevelValue(text, 'profile') ?? '',
  })
  const { ctx, schemaError } = validationContext(inputs)
  return { result: validateFrontmatter(text, ctx), schemaError }
}

const line = (file: string, f: Finding): string =>
  `${file}:${f.line}: ${LABEL[f.severity]}: ${findingMessage(f)}${f.suggestion === null ? '' : ` → ${f.suggestion}`}`

export async function runValidate(
  args: string[],
  env: Env,
  out: (s: string) => void,
  err: (s: string) => void,
): Promise<number> {
  const o = parseArgs(args)
  if (!o) {
    err(USAGE)
    return 2
  }
  let text: string
  try {
    text = utf8.decode(fs.readFileSync(o.file))
  } catch (e) {
    err(`markdown-office: ${o.file} kann nicht gelesen werden: ${(e as Error).message}\n`)
    return 2
  }

  let { result, schemaError } = await check(text, o.file, env)
  let fixed = 0
  if (o.fix || o.addMissing) {
    // Hints are never preselected, so --fix leaves typo guesses alone.
    const ids = new Set(
      o.fix && result.kind === 'checked'
        ? result.findings.filter((f) => f.preselected).map((f) => f.id)
        : [],
    )
    const changes = selectedChanges(result, ids, o.addMissing)
    if (changes.length > 0) {
      fixed = ids.size
      try {
        writeAtomic(o.file, Buffer.from(applyChanges(text, changes), 'utf8'))
      } catch (e) {
        err(`markdown-office: ${o.file} kann nicht geschrieben werden: ${(e as Error).message}\n`)
        return 2
      }
      text = applyChanges(text, changes)
      // The exit code and the report describe the file as it is now.
      ;({ result, schemaError } = await check(text, o.file, env))
    }
  }

  if (schemaError !== null) {
    err(
      `Das Schema des Sets ${noteSet(text) || 'der Vorlage'} ist fehlerhaft; geprüft wird nur gegen die Pipeline-Regeln.\n`,
    )
  }
  report(result, o, noteSet(text), fixed, out, err)
  return errorCount(result) > 0 || result.kind === 'unclosed' ? 1 : 0
}

function report(
  result: ValidationResult,
  o: Options,
  set: string,
  fixed: number,
  out: (s: string) => void,
  err: (s: string) => void,
): void {
  const findings = result.kind === 'checked' ? result.findings : []
  const missing = result.kind === 'checked' ? result.missing : []
  if (o.json) {
    out(
      `${JSON.stringify({
        file: o.file,
        set,
        findings: findings.map((f) => ({
          line: f.line,
          key: f.key,
          code: f.code,
          severity: f.severity,
          message: findingMessage(f),
          suggestion: f.suggestion,
        })),
        missing,
        fixed,
      })}\n`,
    )
    return
  }
  if (result.kind === 'none') err(`${o.file}: kein YAML-Kopf gefunden.\n`)
  if (result.kind === 'unclosed')
    err(`${o.file}: der YAML-Kopf ist nicht geschlossen („---“ fehlt).\n`)
  for (const f of findings) out(`${line(o.file, f)}\n`)
  if (missing.length > 0) out(`Fehlende Schlüssel (${set}): ${missing.join(', ')}\n`)
  if (fixed > 0) out(`${fixed} Korrektur${fixed === 1 ? '' : 'en'} geschrieben.\n`)
  if (result.kind === 'checked' && findings.length === 0 && missing.length === 0) {
    out('YAML in Ordnung\n')
  }
}
