import type { Mode } from '../../shared/types'

export const ZOOM_STEPS: readonly number[] = [
  0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
]
const EPS = 1e-9
const round2 = (n: number) => Math.round(n * 100) / 100

export function zoomIn(z: number): number {
  return ZOOM_STEPS.find((s) => s > z + EPS) ?? (ZOOM_STEPS.at(-1) as number)
}

export function zoomOut(z: number): number {
  return [...ZOOM_STEPS].reverse().find((s) => s < z - EPS) ?? (ZOOM_STEPS[0] as number)
}

export function zoomLabel(z: number): string {
  return `${Math.round(z * 100)} %`
}

/** Edit 100 % = PDF size (10pt body, 9pt code); Present multiplies by the configured factor. */
export function editorSizes(
  mode: Mode,
  zoom: number,
  presentFactor: number,
): { body: string; code: string } {
  const f = (mode === 'present' ? presentFactor : 1) * zoom
  return { body: `${round2(10 * f)}pt`, code: `${round2(9 * f)}pt` }
}

export type ZoomAction = 'in' | 'out' | 'reset'

/** The KeyboardEvent fields zoomKey reads. */
export interface ZoomKeyEvent {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Mod+Plus/Minus/0 on any layout. The menu accelerator CmdOrCtrl+Plus means Shift+'=' and
 * misses German '+' (no Shift) and the numpad, so the renderer recognises the keys itself.
 * '=' and '0' need no Shift: German Ctrl+Shift+0 types '=' and must not zoom.
 */
export function zoomKey(e: ZoomKeyEvent, mac: boolean): ZoomAction | null {
  const mod = mac ? e.metaKey : e.ctrlKey
  if (!mod || e.altKey) return null
  if (e.key === '+' || e.code === 'NumpadAdd') return 'in'
  if (e.key === '=' && !e.shiftKey) return 'in'
  if (e.key === '-' || e.code === 'NumpadSubtract') return 'out'
  if (e.code === 'Numpad0' || (e.key === '0' && !e.shiftKey)) return 'reset'
  return null
}

/**
 * Applies a zoom key once and claims it (preventDefault): Chromium hands keys to the page
 * before the menu, so a claimed key never also fires the menu accelerator (no double step).
 */
export function handleZoomKey(
  e: ZoomKeyEvent & { defaultPrevented?: boolean; preventDefault(): void },
  mac: boolean,
  apply: (action: ZoomAction) => void,
): boolean {
  if (e.defaultPrevented) return false
  const action = zoomKey(e, mac)
  if (!action) return false
  e.preventDefault()
  apply(action)
  return true
}
