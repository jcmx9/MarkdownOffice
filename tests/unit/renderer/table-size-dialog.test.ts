// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { askTableSize } from '../../../src/renderer/ui/table-size-dialog'

afterEach(() => document.body.replaceChildren())

function open() {
  const result = askTableSize()
  const dialog = document.querySelector('dialog') as HTMLDialogElement
  const [cols, rows] = [...dialog.querySelectorAll('input')] as HTMLInputElement[]
  const ok = dialog.querySelector('button[type=submit]') as HTMLButtonElement
  const cancel = dialog.querySelector('button[type=button]') as HTMLButtonElement
  const form = dialog.querySelector('form') as HTMLFormElement
  const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  return { result, dialog, cols, rows, ok, cancel, submit }
}

describe('askTableSize', () => {
  it('opens a modal dialog with two number fields, 3 × 3 by default, columns focused', () => {
    const { dialog, cols, rows } = open()
    expect(dialog.open).toBe(true)
    expect(dialog.querySelector('h2')?.textContent).toBe('Tabelle einfügen')
    expect([cols?.type, cols?.min, cols?.max, cols?.value]).toEqual(['number', '1', '8', '3'])
    expect([rows?.type, rows?.min, rows?.max, rows?.value]).toEqual(['number', '1', '10', '3'])
    expect(cols?.labels?.[0]?.textContent).toContain('Spalten (1–8)')
    expect(rows?.labels?.[0]?.textContent).toContain('Zeilen mit Kopfzeile (1–10)')
    expect(document.activeElement).toBe(cols)
  })

  it('OK resolves the entered size and removes the dialog', async () => {
    const { result, cols, rows, submit } = open()
    if (!cols || !rows) throw new Error('fields missing')
    cols.value = '5'
    rows.value = '7'
    submit()
    expect(await result).toEqual({ cols: 5, rows: 7 })
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('the defaults are taken unchanged', async () => {
    const { result, submit } = open()
    submit()
    expect(await result).toEqual({ cols: 3, rows: 3 })
  })

  it('Abbrechen and Esc resolve null', async () => {
    const a = open()
    a.cancel.click()
    expect(await a.result).toBeNull()
    const b = open()
    b.dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    b.dialog.close()
    expect(await b.result).toBeNull()
  })

  // The browser's constraint check blocks an invalid submit; this guards whatever slips past.
  it.each([
    ['0', '3'],
    ['9', '3'],
    ['3', '11'],
    ['2.5', '3'],
    ['', '3'],
  ])('refuses %s × %s (out of range or not a whole number)', async (c, r) => {
    const { result, cols, rows, submit } = open()
    if (!cols || !rows) throw new Error('fields missing')
    cols.value = c
    rows.value = r
    submit()
    expect(await result).toBeNull()
  })
})
