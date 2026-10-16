// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { modeCompartment, modeExtensions, presentMode } from '../../../src/renderer/editor/mode'

describe('mode compartment', () => {
  it('Present sets the facet, Edit clears it', () => {
    const s = EditorState.create({ extensions: modeCompartment.of(modeExtensions('present')) })
    expect(s.facet(presentMode)).toBe(true)
    const e = s.update({ effects: modeCompartment.reconfigure(modeExtensions('edit')) }).state
    expect(e.facet(presentMode)).toBe(false)
  })
  it('defaults to false without the compartment', () => {
    expect(EditorState.create({}).facet(presentMode)).toBe(false)
  })
})

describe('mdo-present class', () => {
  it('is on the editor in Present and gone in Edit', () => {
    const view = new EditorView({
      state: EditorState.create({ extensions: modeCompartment.of(modeExtensions('present')) }),
    })
    expect(view.dom.classList.contains('mdo-present')).toBe(true)
    view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions('edit')) })
    expect(view.dom.classList.contains('mdo-present')).toBe(false)
    view.destroy()
  })
})
