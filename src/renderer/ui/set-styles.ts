import { type SetCssRule, scopeSetCss } from '../../core/set-css'
import { SET_NAME_RE } from '../../core/sets'

/** Attribute on the host naming the shown note's set; the scope of that set's style. */
export const SET_ATTR = 'data-mdo-set'
const STYLE_ATTR = 'data-mdo-set-css'

/**
 * The scope prefix of a set's rules. The id keeps set rules above the theme defaults on
 * `.cm-editor`. The name is checked against SET_NAME_RE because it ends up inside a selector
 * string: a quote or bracket in it could end the attribute selector early.
 */
export function setScope(set: string): string {
  if (!SET_NAME_RE.test(set)) throw new Error(`invalid set name: ${set}`)
  return `#editor[${SET_ATTR}="${set}"]`
}

/** One `<style>` per loaded set in `<head>`, switched on by the host's `data-mdo-set`. */
export class SetStyles {
  constructor(
    private readonly doc: Document,
    private readonly host: HTMLElement,
  ) {}

  /** Replaces the set's `<style data-mdo-set-css="<set>">`; [] removes it. */
  load(set: string, rules: readonly SetCssRule[]): void {
    const scope = setScope(set)
    const old = [...this.doc.head.querySelectorAll(`style[${STYLE_ATTR}]`)].find(
      (el) => el.getAttribute(STYLE_ATTR) === set,
    )
    if (rules.length === 0) {
      old?.remove()
      return
    }
    const style = old ?? this.doc.createElement('style')
    style.setAttribute(STYLE_ATTR, set)
    style.textContent = scopeSetCss(rules, scope)
    if (!old) this.doc.head.append(style)
  }

  /** The shown note's set on the host (null removes the attribute). */
  show(set: string | null): void {
    if (set === null) this.host.removeAttribute(SET_ATTR)
    else {
      setScope(set)
      this.host.setAttribute(SET_ATTR, set)
    }
  }
}
