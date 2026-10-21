// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { Finding, ValidationResult } from '../../../src/core/frontmatter-validate'
import { openValidateDialog } from '../../../src/renderer/ui/validate-dialog'

type Checked = Extract<ValidationResult, { kind: 'checked' }>

const finding = (over: Partial<Finding>): Finding => ({
  id: 'validate.bool:3:toc',
  code: 'validate.bool',
  severity: 'error',
  line: 3,
  key: 'toc',
  params: { value: 'ja' },
  suggestion: 'true',
  changes: [{ from: 10, to: 17, insert: 'toc: true' }],
  preselected: true,
  ...over,
})

const TOC = finding({})
const TYPO = finding({
  id: 'validate.key.typo:4:titel',
  code: 'validate.key.typo',
  severity: 'hint',
  line: 4,
  key: 'titel',
  params: { similar: 'title' },
  suggestion: 'title',
  preselected: false,
})
const PROFILE = finding({
  id: 'validate.profile.missing:5:profile',
  code: 'validate.profile.missing',
  line: 5,
  key: 'profile',
  params: { value: 'kanzlei', searched: '' },
  suggestion: null,
  changes: [],
  preselected: false,
})

const result = (over: Partial<Checked> = {}): Checked => ({
  kind: 'checked',
  findings: [TOC, TYPO, PROFILE],
  missing: ['lang', 'author'],
  missingChanges: [{ from: 30, to: 30, insert: 'lang: de\n' }],
  ...over,
})

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.querySelector<T>(`[data-testid="${id}"]`)
  if (!el) throw new Error(`missing ${id}`)
  return el
}
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="validate-row"]')]
const box = (row: HTMLElement | undefined) => row?.querySelector('input[type="checkbox"]')
const press = (target: HTMLElement, key: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('validate dialog', () => {
  it('shows one row per finding with line, key, message and suggestion', () => {
    void openValidateDialog({ set: 'memo', result: result() })
    expect(document.querySelector('dialog h2')?.textContent).toBe('YAML prüfen')
    expect($('validate-dialog').textContent).toContain('memo')
    const [toc, typo, profile] = rows()
    expect(rows()).toHaveLength(3)
    expect(toc?.textContent).toContain('Zeile 3')
    expect(toc?.textContent).toContain('toc')
    expect(toc?.textContent).toContain('erwartet true oder false')
    expect(toc?.textContent).toContain('→ true')
    expect(typo?.textContent).toContain('→ title')
    expect(profile?.textContent).toContain('kanzlei')
    expect(profile?.textContent).not.toContain('→')
  })

  it('preselects by finding; hints unchecked; no checkbox without a fix', () => {
    void openValidateDialog({ set: 'memo', result: result() })
    const [toc, typo, profile] = rows()
    expect((box(toc) as HTMLInputElement).checked).toBe(true)
    expect((box(typo) as HTMLInputElement).checked).toBe(false)
    expect(box(profile)).toBeNull()
  })

  it('lists the missing keys with one unchecked checkbox', () => {
    void openValidateDialog({ set: 'memo', result: result() })
    const missing = $('validate-missing')
    expect(missing.textContent).toContain('Fehlende ergänzen (2)')
    expect(missing.textContent).toContain('lang')
    expect(missing.textContent).toContain('author')
    const boxes = missing.querySelectorAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(1)
    expect((boxes[0] as HTMLInputElement).checked).toBe(false)
  })

  it('has no missing section when nothing is missing', () => {
    void openValidateDialog({ set: 'memo', result: result({ missing: [], missingChanges: [] }) })
    expect(document.querySelector('[data-testid="validate-missing"]')).toBeNull()
  })

  it('„Übernehmen“ resolves the ticked findings and the missing choice', async () => {
    const choice = openValidateDialog({ set: 'memo', result: result() })
    const [toc, typo] = rows()
    ;(box(toc) as HTMLInputElement).checked = false
    ;(box(typo) as HTMLInputElement).checked = true
    ;($('validate-missing').querySelector('input') as HTMLInputElement).checked = true
    $('validate-apply').click()
    expect(await choice).toEqual({ ids: new Set([TYPO.id]), addMissing: true })
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('Enter resolves the preselection', async () => {
    const choice = openValidateDialog({ set: 'memo', result: result() })
    press(box(rows()[0]) as HTMLInputElement, 'Enter')
    expect(await choice).toEqual({ ids: new Set([TOC.id]), addMissing: false })
  })

  it('focuses the first checkbox like the template picker focuses its first choice', () => {
    void openValidateDialog({ set: 'memo', result: result() })
    expect(document.activeElement).toBe(box(rows()[0]))
  })

  it('focuses „Übernehmen“ when there is nothing to tick', () => {
    void openValidateDialog({
      set: 'memo',
      result: result({ findings: [PROFILE], missing: [], missingChanges: [] }),
    })
    expect(document.activeElement).toBe($('validate-apply'))
  })

  it('cancels on Abbrechen, Esc and the native close', async () => {
    const a = openValidateDialog({ set: 'memo', result: result() })
    $('validate-cancel').click()
    expect(await a).toBeNull()
    const b = openValidateDialog({ set: 'memo', result: result() })
    press($('validate-dialog'), 'Escape')
    expect(await b).toBeNull()
    const c = openValidateDialog({ set: 'memo', result: result() })
    $<HTMLDialogElement>('validate-dialog').close()
    expect(await c).toBeNull()
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('shows a notice above the findings', () => {
    void openValidateDialog({ set: 'eigen', result: result(), notice: 'Schema kaputt' })
    expect($('validate-notice').textContent).toBe('Schema kaputt')
  })

  it('shows no notice by default', () => {
    void openValidateDialog({ set: 'memo', result: result() })
    expect(document.querySelector('[data-testid="validate-notice"]')).toBeNull()
  })
})
