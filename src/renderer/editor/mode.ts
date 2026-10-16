import { Compartment, type Extension, Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Mode } from '../../shared/types'

/** True in Present: the header shows as the title block and is read-only regardless of the toggle. */
export const presentMode = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

export const modeCompartment = new Compartment()

export function modeExtensions(mode: Mode): Extension {
  return mode === 'present'
    ? [presentMode.of(true), EditorView.editorAttributes.of({ class: 'mdo-present' })]
    : []
}
