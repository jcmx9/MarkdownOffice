// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  pickerSets,
  pickTemplate,
  type TemplatePickerDeps,
} from '../../../src/renderer/ui/template-picker'
import type { SetInfo } from '../../../src/shared/types'

const MEMO: SetInfo = { name: 'memo', source: 'bundled', hint: 'Notiz', hasProfile: false }
const BRIEF: SetInfo = { name: 'din5008a', source: 'bundled', hint: 'Brief', hasProfile: true }
const EIGEN: SetInfo = {
  name: 'eigen',
  source: 'user',
  hint: 'ohne Header-Vorlage',
  hasProfile: false,
}

const HEADERS: Record<string, string> = {
  din5008a: '---\ntemplate: din5008a\nprofile: kanzlei   # Profil\n---\n',
  memo: '---\ntemplate: memo\n---\n',
}

const deps = (over: Partial<TemplatePickerDeps> = {}): TemplatePickerDeps => ({
  title: 'Neu aus Vorlage',
  confirm: 'Erstellen',
  sets: [BRIEF, EIGEN],
  header: vi.fn(async (n: string) => HEADERS[n] ?? null),
  profiles: vi.fn(async () => ['beispiel', 'kanzlei']),
  ...over,
})

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.querySelector<T>(`[data-testid="${id}"]`)
  if (!el) throw new Error(`missing ${id}`)
  return el
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`)
const press = (target: HTMLElement, key: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}
const choose = (name: string) => {
  const radio = $<HTMLInputElement>(`tpl-set-${name}`)
  radio.checked = true
  radio.dispatchEvent(new Event('change', { bubbles: true }))
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('pickerSets', () => {
  it("puts the default set first, the others keep main's order", () => {
    expect(pickerSets([BRIEF, EIGEN, MEMO])).toEqual([MEMO, BRIEF, EIGEN])
  })
  it('lists only the others when the default set is missing', () => {
    expect(pickerSets([BRIEF, EIGEN])).toEqual([BRIEF, EIGEN])
  })
})

describe('template picker', () => {
  it('lists every set with name, hint and source; the first is selected', async () => {
    void pickTemplate(deps())
    await flush()
    expect(document.querySelector('dialog h2')?.textContent).toBe('Neu aus Vorlage')
    expect($('tpl-row-din5008a').textContent).toContain('din5008a')
    expect($('tpl-row-din5008a').textContent).toContain('Brief')
    expect($('tpl-row-din5008a').textContent).toContain('mitgeliefert')
    expect($('tpl-row-eigen').textContent).toContain('ohne Header-Vorlage')
    expect($('tpl-row-eigen').textContent).toContain('eigene')
    expect($<HTMLInputElement>('tpl-set-din5008a').checked).toBe(true)
    expect($('tpl-ok').textContent).toBe('Erstellen')
  })

  it('preselects the requested set', async () => {
    void pickTemplate(deps({ sets: [MEMO, BRIEF], selected: 'memo' }))
    await flush()
    expect($<HTMLInputElement>('tpl-set-memo').checked).toBe(true)
    expect($('tpl-profile-row').hidden).toBe(true)
  })

  it('offers the profiles of a set with profile:, preselecting the header’s value', async () => {
    const d = deps()
    const result = pickTemplate(d)
    await flush()
    expect(d.profiles).toHaveBeenCalledWith('din5008a')
    const select = $<HTMLSelectElement>('tpl-profile')
    expect($('tpl-profile-row').hidden).toBe(false)
    expect([...select.options].map((o) => o.value)).toEqual(['beispiel', 'kanzlei'])
    expect(select.value).toBe('kanzlei')
    select.value = 'beispiel'
    $('tpl-ok').click()
    expect(await result).toEqual({ name: 'din5008a', profile: 'beispiel' })
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('preselects the first profile when the header’s value is not on disk', async () => {
    void pickTemplate(deps({ profiles: vi.fn(async () => ['anna', 'ben']) }))
    await flush()
    expect($<HTMLSelectElement>('tpl-profile').value).toBe('anna')
  })

  it('shows a hint and returns no profile when the set has no profiles', async () => {
    const result = pickTemplate(deps({ profiles: vi.fn(async () => []) }))
    await flush()
    expect($('tpl-profile-hint').hidden).toBe(false)
    expect($('tpl-profile-hint').textContent).toContain('Vorlagen/profiles/')
    expect($('tpl-profile').hidden).toBe(true)
    $('tpl-ok').click()
    expect(await result).toEqual({ name: 'din5008a', profile: null })
  })

  it('hides the profile choice for a set without profile: and returns no profile', async () => {
    const d = deps()
    const result = pickTemplate(d)
    await flush()
    choose('eigen')
    await flush()
    expect($('tpl-profile-row').hidden).toBe(true)
    press($<HTMLInputElement>('tpl-set-eigen'), 'Enter')
    expect(await result).toEqual({ name: 'eigen', profile: null })
  })

  it('ignores a profile list that arrives after the selection moved on', async () => {
    let release: (v: string[]) => void = () => undefined
    const d = deps({
      profiles: vi.fn(
        () =>
          new Promise<string[]>((r) => {
            release = r
          }),
      ),
    })
    const result = pickTemplate(d)
    await flush()
    choose('eigen')
    release(['spät'])
    await flush()
    expect($('tpl-profile-row').hidden).toBe(true)
    $('tpl-ok').click()
    expect(await result).toEqual({ name: 'eigen', profile: null })
  })

  it('cancels on Abbrechen, Esc and the native close', async () => {
    const a = pickTemplate(deps())
    $('tpl-cancel').click()
    expect(await a).toBeNull()
    const b = pickTemplate(deps())
    press($('tpl-dialog'), 'Escape')
    expect(await b).toBeNull()
    const c = pickTemplate(deps())
    $<HTMLDialogElement>('tpl-dialog').close()
    expect(await c).toBeNull()
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('with no sets shows a message and only Abbrechen', async () => {
    const d = deps({ sets: [] })
    const result = pickTemplate(d)
    expect($('tpl-empty').textContent).toContain('Keine Vorlagen')
    expect(q('tpl-ok')).toBeNull()
    press($('tpl-dialog'), 'Enter')
    expect(document.querySelector('dialog')).not.toBeNull()
    $('tpl-cancel').click()
    expect(await result).toBeNull()
    expect(d.profiles).not.toHaveBeenCalled()
  })

  it('survives a failing profile lookup', async () => {
    const result = pickTemplate(
      deps({ profiles: vi.fn(async () => Promise.reject(new Error('x'))) }),
    )
    await flush()
    expect($('tpl-profile-hint').hidden).toBe(false)
    $('tpl-ok').click()
    expect(await result).toEqual({ name: 'din5008a', profile: null })
  })
})
