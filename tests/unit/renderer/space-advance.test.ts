// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  SPACE_ADVANCE_VAR,
  SpaceAdvance,
  spaceAdvanceEm,
} from '../../../src/renderer/ui/space-advance'

describe('spaceAdvanceEm', () => {
  it('divides the space width by the body font size', () => {
    // Source Sans: 2.667px at 13.333px (10pt) = 0.2em
    expect(spaceAdvanceEm({ width: 2.6667, fontSize: 13.3333 })).toBe(0.2)
    expect(spaceAdvanceEm({ width: 3.49, fontSize: 14.6667 })).toBe(0.238)
  })
  it('gives nothing without layout (zero or missing sizes)', () => {
    expect(spaceAdvanceEm({ width: 0, fontSize: 13 })).toBeNull()
    expect(spaceAdvanceEm({ width: 3, fontSize: 0 })).toBeNull()
    expect(spaceAdvanceEm({ width: Number.NaN, fontSize: 13 })).toBeNull()
  })
})

describe('SpaceAdvance', () => {
  let host: HTMLElement
  beforeEach(() => {
    document.body.innerHTML = ''
    host = document.createElement('div')
    host.className = 'cm-editor mdo-code'
    document.body.append(host)
  })

  it('measures a probe styled like a preview body line and writes the em value', async () => {
    let seen: HTMLElement | null = null
    const sa = new SpaceAdvance(() => host, {
      settle: async () => {},
      loading: () => false,
      measure: (span) => {
        seen = span
        return { width: 2.6667, fontSize: 13.3333 }
      },
    })
    await sa.update()
    expect(host.style.getPropertyValue(SPACE_ADVANCE_VAR)).toBe('0.2em')
    // the probe carries the preview classes (any mode) and is gone afterwards
    const probe = seen as HTMLElement | null
    expect(probe?.textContent).toBe(' ')
    // .cm-content too: a set may set the body font or word spacing there (allowed selector)
    expect(probe?.closest('.mdo-preview .cm-scroller .cm-content .cm-line')).not.toBeNull()
    expect(host.querySelector('.mdo-preview')).toBeNull()
  })

  it('measures again on every update (set change) and keeps the last value', async () => {
    let width = 2.6667
    const sa = new SpaceAdvance(() => host, {
      settle: async () => {},
      loading: () => false,
      measure: () => ({ width, fontSize: 13.3333 }),
    })
    await sa.update()
    width = 3.1733
    await sa.update()
    expect(host.style.getPropertyValue(SPACE_ADVANCE_VAR)).toBe('0.238em')
  })

  it('remeasures once when the probe started a font load', async () => {
    // the first measurement requests the font, the second settle waits for it
    let loading = false
    let calls = 0
    const sa = new SpaceAdvance(() => host, {
      settle: async () => {
        loading = false
      },
      loading: () => loading,
      measure: () => {
        calls++
        if (calls === 1) loading = true
        return { width: calls === 1 ? 4 : 2.6667, fontSize: 13.3333 }
      },
    })
    await sa.update()
    expect(host.style.getPropertyValue(SPACE_ADVANCE_VAR)).toBe('0.2em')
  })

  it('a slower, older measurement never overwrites a newer one', async () => {
    const waits: Array<() => void> = []
    let width = 4
    const sa = new SpaceAdvance(() => host, {
      settle: () => new Promise<void>((r) => waits.push(r)),
      loading: () => false,
      measure: () => ({ width, fontSize: 13.3333 }),
    })
    const first = sa.update()
    const second = sa.update()
    width = 2.6667
    waits[1]?.()
    await second
    waits[0]?.()
    await first
    expect(host.style.getPropertyValue(SPACE_ADVANCE_VAR)).toBe('0.2em')
  })

  it('leaves the theme fallback when nothing can be measured', async () => {
    const sa = new SpaceAdvance(() => host, {
      settle: async () => {},
      loading: () => false,
      measure: () => ({ width: 0, fontSize: 0 }),
    })
    await sa.update()
    expect(host.style.getPropertyValue(SPACE_ADVANCE_VAR)).toBe('')
  })
})
