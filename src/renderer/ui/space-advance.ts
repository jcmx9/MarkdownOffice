/**
 * The body font's space advance per set, as `--mdo-space-advance` on the editor element.
 *
 * CodeMirror wraps with `white-space: break-spaces`, so the space before a break does not hang:
 * a line must fit its text plus one space. theme.css widens the measure by this advance (and
 * sizes the list marker slot with it) so the preview breaks where the PDF does (findings step2
 * §3 S, §4.3). Measured, not a token, so user sets with other fonts need no extra value. In em,
 * so the zoom never needs a new measurement.
 */

export const SPACE_ADVANCE_VAR = '--mdo-space-advance'

export interface SpaceProbe {
  width: number
  fontSize: number
}

export interface SpaceAdvanceDeps {
  /** Resolves once the set's styles are laid out and the fonts in use have loaded. */
  settle(): Promise<void>
  /** True while fonts are still loading (the probe itself may have requested one). */
  loading(): boolean
  measure(span: HTMLElement): SpaceProbe
}

/** The advance in em, rounded to 4 places; null without layout. */
export function spaceAdvanceEm({ width, fontSize }: SpaceProbe): number | null {
  if (!(width > 0) || !(fontSize > 0)) return null
  return Math.round((width / fontSize) * 10000) / 10000
}

const realDeps: SpaceAdvanceDeps = {
  settle: async () => {
    // One frame, so the newly scoped set rules are applied and their fonts requested.
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    await document.fonts?.ready
  },
  loading: () => document.fonts?.status === 'loading',
  measure: (span) => ({
    width: span.getBoundingClientRect().width,
    fontSize: Number.parseFloat(getComputedStyle(span).fontSize),
  }),
}

/**
 * A hidden copy of a preview body line: `.mdo-preview .cm-scroller .cm-line` picks up the body
 * font, weight, optical size and word spacing from theme.css and the set's scoped rules, in Code
 * view too. Inserted only for the synchronous measurement, so no test or code ever sees a second
 * `.cm-scroller`; outside the content DOM, so CodeMirror's observer never notices it.
 */
function probe(doc: Document): { root: HTMLElement; span: HTMLElement } {
  const root = doc.createElement('div')
  root.className = 'mdo-preview'
  root.setAttribute('aria-hidden', 'true')
  root.style.cssText =
    'position:absolute;top:0;left:0;visibility:hidden;pointer-events:none;height:0;overflow:hidden'
  const scroller = doc.createElement('div')
  scroller.className = 'cm-scroller'
  const line = doc.createElement('div')
  line.className = 'cm-line'
  const span = doc.createElement('span')
  span.style.whiteSpace = 'pre'
  span.textContent = ' '
  line.append(span)
  scroller.append(line)
  root.append(scroller)
  return { root, span }
}

export class SpaceAdvance {
  private seq = 0

  constructor(
    private readonly target: () => HTMLElement,
    private readonly deps: SpaceAdvanceDeps = realDeps,
  ) {}

  /** After a set's styles were applied or another set is shown. */
  async update(): Promise<void> {
    const seq = ++this.seq
    await this.deps.settle()
    if (seq !== this.seq) return
    let p = this.measureOnce()
    // The probe may be the first user of a font (e.g. in Code view): wait for it once.
    if (this.deps.loading()) {
      await this.deps.settle()
      if (seq !== this.seq) return
      p = this.measureOnce()
    }
    const em = p && spaceAdvanceEm(p)
    if (em !== null && em !== undefined) {
      this.target().style.setProperty(SPACE_ADVANCE_VAR, `${em}em`)
    }
  }

  private measureOnce(): SpaceProbe | null {
    const host = this.target()
    const { root, span } = probe(host.ownerDocument)
    host.append(root)
    try {
      return this.deps.measure(span)
    } finally {
      root.remove()
    }
  }
}
