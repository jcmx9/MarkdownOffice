import {
  errorCount,
  topLevelValue,
  type ValidationContext,
  validateFrontmatter,
} from '../../core/frontmatter-validate'

/** What the status line shows about the note's set: its `template:` and the check's errors. */
export interface SetStatus {
  /** The note's `template:` value as written (a set name, or a `.typ` path). */
  name: string
  /** Findings of severity error only, the rule of the export banner and the CLI exit code. */
  errors: number
  /** `template:` names no installed set (one of the errors). */
  unknown: boolean
}

/**
 * The status of a note's text, null when it names no set (no `template:` or an empty one):
 * the status line then shows nothing rather than guessing the default set.
 */
export function setStatus(text: string, ctx: ValidationContext): SetStatus | null {
  const name = topLevelValue(text, 'template')
  if (!name) return null
  const result = validateFrontmatter(text, ctx)
  const unknown =
    result.kind === 'checked' && result.findings.some((f) => f.code === 'validate.template.unknown')
  return { name, errors: errorCount(result), unknown }
}

/** Tooltip of the set name; a missing set is named, since „1 Fehler“ alone would not say why. */
export function setTitle(s: SetStatus): string {
  if (s.errors === 0) return s.name
  const count = `${s.errors} Fehler im YAML-Kopf`
  return s.unknown ? `${s.name} – ${count} (Set nicht installiert)` : `${s.name} – ${count}`
}

/**
 * What main's validation inputs depend on: the note's file (only once on disk, like
 * validationFor) and its raw `template:` and `profile:`. Equal keys share cached inputs.
 */
export function inputsKey(path: string | null, text: string): string {
  return JSON.stringify([
    path ?? '',
    topLevelValue(text, 'template') ?? '',
    topLevelValue(text, 'profile') ?? '',
  ])
}

export interface SetCheckHost {
  /**
   * The tab's current text and inputs key; null when the tab is gone or no longer shown
   * (nothing may be painted for it then).
   */
  snapshot(tabId: number): { text: string; key: string } | null
  /**
   * The validation context from main's inputs; `cache` is false when main did not answer (a
   * pipeline-only fallback must not stick until the key changes). null = the tab is gone.
   */
  context(tabId: number): Promise<{ ctx: ValidationContext; cache: boolean } | null>
  paint(tabId: number, status: SetStatus | null): void
}

/**
 * The silent background check behind the status line's set name. Typing is debounced; main is
 * asked for the inputs only when the key (path, `template:`, `profile:`) differs from the
 * tab's cached one, so a keystroke never costs an IPC round trip. A result is painted only
 * when no newer run started meanwhile and the tab still shows the text it was computed for.
 */
export class SetCheck {
  private timer: ReturnType<typeof setTimeout> | null = null
  private seq = 0
  private readonly cache = new Map<number, { key: string; ctx: ValidationContext }>()

  constructor(
    private readonly host: SetCheckHost,
    private readonly delay = 500,
  ) {}

  /** After an edit: checks once typing has paused for `delay` ms. */
  schedule(tabId: number): void {
    this.cancel()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run(tabId, false)
    }, this.delay)
  }

  /**
   * Checks at once (a note opened or shown, a reload). fresh: ask main again even for an
   * unchanged key, since sets or profiles may have been installed meanwhile.
   */
  now(tabId: number, fresh = false): Promise<void> {
    this.cancel()
    return this.run(tabId, fresh)
  }

  /** A closed tab's cached inputs. */
  forget(tabId: number): void {
    this.cache.delete(tabId)
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private async run(tabId: number, fresh: boolean): Promise<void> {
    const seq = ++this.seq
    const snap = this.host.snapshot(tabId)
    if (!snap) return
    // No set named: nothing to show, and no reason to ask main.
    if (!topLevelValue(snap.text, 'template')) {
      this.host.paint(tabId, null)
      return
    }
    let ctx: ValidationContext
    const hit = this.cache.get(tabId)
    if (!fresh && hit?.key === snap.key) ctx = hit.ctx
    else {
      const answer = await this.host.context(tabId)
      // A newer run (typing paused again, another tab shown) owns the status line now.
      if (!answer || seq !== this.seq) return
      if (answer.cache) this.cache.set(tabId, { key: snap.key, ctx: answer.ctx })
      else this.cache.delete(tabId)
      ctx = answer.ctx
      // The text typed on while main answered: its own debounced run paints, not this one.
      const now = this.host.snapshot(tabId)
      if (!now || now.text !== snap.text) return
    }
    this.host.paint(tabId, setStatus(snap.text, ctx))
  }
}
