import { resolve } from 'node:path'
import { MAX_RECENT } from './store'

export type CliAction = { kind: 'version' } | { kind: 'help' } | { kind: 'open'; paths: string[] }

export const HELP_TEXT = `Markdown Office – Markdown-Editor mit PDF-Export

Aufruf:
  markdown-office --app [datei.md …]    Dateien öffnen (bei laufender Instanz dort als Tab)
  markdown-office --app --version, -V   Version ausgeben
  markdown-office --app --help, -h      Diese Hilfe
`

/** Strips the executable (and, unpackaged, the app path) from process.argv. */
export function argsFromArgv(argv: readonly string[], isPackaged: boolean): string[] {
  const rest = argv.slice(1)
  if (isPackaged) return rest
  const appIndex = rest.findIndex((a) => !a.startsWith('-'))
  return appIndex < 0 ? rest : [...rest.slice(0, appIndex), ...rest.slice(appIndex + 1)]
}

/**
 * Every argument starting with `-` is a flag, never a file. That covers a stray `--app` (the
 * `markdown-office --app` launcher normally removes it) as well as macOS's -psn_ and Chromium
 * switches.
 */
export function parseCli(args: readonly string[], cwd: string): CliAction {
  if (args.includes('--version') || args.includes('-V')) return { kind: 'version' }
  if (args.includes('--help') || args.includes('-h')) return { kind: 'help' }
  return {
    kind: 'open',
    paths: args.filter((a) => !a.startsWith('-')).map((a) => resolve(cwd, a)),
  }
}

export function addRecent(list: readonly string[], path: string, max = MAX_RECENT): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, max)
}

export function replaceRecent(list: readonly string[], from: string, to: string): string[] {
  return [...new Set(list.map((p) => (p === from ? to : p)))]
}
