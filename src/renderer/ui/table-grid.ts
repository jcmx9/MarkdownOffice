/** Grid limits; insertTable (table-edit.ts) refuses anything larger. */
export const GRID_COLS = 8
export const GRID_ROWS = 10

export interface GridSize {
  cols: number
  rows: number
}

/**
 * The „Tabelle ▾“ size picker (spec section 4): 8 columns × 10 rows of cells, hovering or the
 * arrow keys choose a size shown as „3 × 4“ (columns × rows, the header row counted), a click or
 * Enter reports it, Esc cancels. The toolbar opens and closes it; the grid only reports.
 *
 * The cells are plain spans, not buttons: the grid element itself holds focus (one tab stop,
 * moved by arrow keys) and announces the size through its live label, so a screen reader hears
 * „3 × 4“ instead of 80 separate buttons.
 */
export class TableGrid {
  readonly el = document.createElement('div')
  private readonly label = document.createElement('div')
  private readonly cells: HTMLSpanElement[] = []
  private cols = 1
  private rows = 1

  constructor(
    private readonly onPick: (size: GridSize) => void,
    private readonly onCancel: () => void,
  ) {
    this.el.className = 'mdo-fmt-grid'
    this.el.dataset.testid = 'fmt-grid'
    this.el.setAttribute('role', 'grid')
    this.el.setAttribute('aria-label', 'Tabellengröße')
    this.el.tabIndex = -1

    const cells = document.createElement('div')
    cells.className = 'mdo-fmt-grid-cells'
    for (let r = 1; r <= GRID_ROWS; r++) {
      for (let c = 1; c <= GRID_COLS; c++) {
        const cell = document.createElement('span')
        cell.className = 'mdo-fmt-grid-cell'
        cell.dataset.col = String(c)
        cell.dataset.row = String(r)
        this.cells.push(cell)
        cells.append(cell)
      }
    }
    this.label.className = 'mdo-fmt-grid-label'
    this.label.dataset.testid = 'fmt-grid-label'
    this.label.setAttribute('aria-live', 'polite')
    this.el.append(cells, this.label)

    // Keep focus on the grid (keyboard keeps working after a hover) instead of the clicked span.
    cells.addEventListener('mousedown', (e) => {
      if (e.button === 0) e.preventDefault()
    })
    cells.addEventListener('mouseover', (e) => {
      const size = sizeOf(e.target)
      if (size) this.set(size.cols, size.rows)
    })
    cells.addEventListener('click', (e) => {
      const size = sizeOf(e.target)
      if (size) this.onPick(size)
    })
    this.el.addEventListener('keydown', (e) => this.key(e))
    this.set(1, 1)
  }

  /** Back to 1 × 1, for a fresh open. */
  reset(): void {
    this.set(1, 1)
  }

  private key(e: KeyboardEvent): void {
    const moves: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowDown: [0, 1],
      ArrowUp: [0, -1],
    }
    const move = moves[e.key]
    if (move) this.set(this.cols + move[0], this.rows + move[1])
    else if (e.key === 'Enter') this.onPick({ cols: this.cols, rows: this.rows })
    else if (e.key === 'Escape') this.onCancel()
    else return
    // Handled keys must not reach the editor or scroll the window.
    e.preventDefault()
    e.stopPropagation()
  }

  private set(cols: number, rows: number): void {
    this.cols = Math.min(GRID_COLS, Math.max(1, cols))
    this.rows = Math.min(GRID_ROWS, Math.max(1, rows))
    for (const cell of this.cells) {
      const on = Number(cell.dataset.col) <= this.cols && Number(cell.dataset.row) <= this.rows
      cell.classList.toggle('on', on)
    }
    this.label.textContent = `${this.cols} × ${this.rows}`
  }
}

function sizeOf(target: EventTarget | null): GridSize | null {
  if (!(target instanceof HTMLElement) || !target.dataset.col || !target.dataset.row) return null
  return { cols: Number(target.dataset.col), rows: Number(target.dataset.row) }
}
