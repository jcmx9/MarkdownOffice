import { GRID_COLS, GRID_ROWS, type GridSize } from './table-grid'

/**
 * Einfügen → „Tabelle …“ (spec section 4): a menu cannot hold the toolbar's size grid, so the
 * size is asked in a small modal dialog with the grid's limits (1–8 columns, 1–10 rows, the
 * header row counted like the grid's „3 × 4“), 3 × 3 preset. Resolves null on Abbrechen/Esc or
 * a size outside the limits. Built like askText (prompt.ts): DOM nodes and textContent only.
 */
export function askTableSize(): Promise<GridSize | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.className = 'prompt'
    const form = document.createElement('form')
    form.method = 'dialog'
    const heading = document.createElement('h2')
    heading.textContent = 'Tabelle einfügen'
    const cols = numberField(`Spalten (1–${GRID_COLS})`, GRID_COLS)
    const rows = numberField(`Zeilen mit Kopfzeile (1–${GRID_ROWS})`, GRID_ROWS)
    const ok = document.createElement('button')
    ok.type = 'submit'
    ok.value = 'ok'
    ok.textContent = 'Einfügen'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Abbrechen'
    cancel.addEventListener('click', () => dialog.close('cancel'))
    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(ok, cancel)
    form.append(heading, cols.label, rows.label, actions)
    dialog.append(form)
    // The browser's constraint check (min/max/step) runs before submit; closing here instead of
    // relying on method="dialog" gives one path in every environment.
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      dialog.close('ok')
    })
    dialog.addEventListener('close', () => {
      const accepted = dialog.returnValue === 'ok'
      const size = {
        cols: whole(cols.input.value, GRID_COLS),
        rows: whole(rows.input.value, GRID_ROWS),
      }
      dialog.remove()
      resolve(accepted && size.cols !== null && size.rows !== null ? (size as GridSize) : null)
    })
    document.body.append(dialog)
    dialog.showModal()
    cols.input.select()
    cols.input.focus()
  })
}

function numberField(
  text: string,
  max: number,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement('label')
  label.textContent = text
  const input = document.createElement('input')
  input.type = 'number'
  input.min = '1'
  input.max = String(max)
  input.step = '1'
  input.value = '3'
  input.required = true
  label.append(input)
  return { label, input }
}

/** A whole number within 1…max, else null (an empty, fractional or out-of-range entry). */
function whole(value: string, max: number): number | null {
  const n = Number(value)
  return value.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= max ? n : null
}
