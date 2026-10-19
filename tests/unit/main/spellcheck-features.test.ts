import { describe, expect, it } from 'vitest'
import {
  type CommandLineLike,
  enableExistingTextSpellcheck,
  SPELLCHECK_FEATURE,
} from '../../../src/main/spellcheck/features'

/** Electron's commandLine keeps one value per switch; appendSwitch replaces it. */
function commandLine(initial?: string) {
  const switches = new Map<string, string>(
    initial === undefined ? [] : [['enable-features', initial]],
  )
  const cl: CommandLineLike = {
    getSwitchValue: (n) => switches.get(n) ?? '',
    appendSwitch: (n, v = '') => void switches.set(n, v),
  }
  return { cl, value: () => switches.get('enable-features') }
}

describe('enableExistingTextSpellcheck', () => {
  it('enables the Blink feature that lets existing text be checked', () => {
    const c = commandLine()
    enableExistingTextSpellcheck(c.cl)
    expect(c.value()).toBe(SPELLCHECK_FEATURE)
  })
  it('keeps features already on the command line and adds itself once', () => {
    const c = commandLine('Foo,Bar')
    enableExistingTextSpellcheck(c.cl)
    enableExistingTextSpellcheck(c.cl)
    expect(c.value()).toBe(`Foo,Bar,${SPELLCHECK_FEATURE}`)
  })
})
