import { Compartment, type Extension, Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Mode } from '../../shared/types'
// format.ts imports presentMode from here; both modules only read the other's facet inside
// functions, so the import cycle is harmless at load time.
import { formatMode } from './format'

/** True in Present: the header shows as the title block and is read-only regardless of the toggle. */
export const presentMode = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

export const modeCompartment = new Compartment()

/**
 * Present does not make the editor read-only, so the format commands read the mode from
 * formatMode (format.ts) and refuse in Present; the same compartment sets it with the mode.
 */
export function modeExtensions(mode: Mode): Extension {
  return mode === 'present'
    ? [
        presentMode.of(true),
        formatMode.of('present'),
        EditorView.editorAttributes.of({ class: 'mdo-present' }),
      ]
    : [formatMode.of('edit')]
}
