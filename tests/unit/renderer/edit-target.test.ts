// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { allowedWithDialog, editTarget } from '../../../src/renderer/ui/edit-target'

describe('editTarget', () => {
  const editor = document.createElement('div')
  const button = document.createElement('button')
  const input = document.createElement('input')

  it('sends the command to the editor by default', () => {
    expect(editTarget(button, editor, false)).toBe('editor')
    expect(editTarget(null, editor, false)).toBe('editor')
  })
  it('blocks it behind an open dialog when a button has focus', () => {
    expect(editTarget(button, editor, true)).toBe('blocked')
    expect(editTarget(null, editor, true)).toBe('blocked')
  })
  it('lets a focused text field keep the command', () => {
    expect(editTarget(input, editor, true)).toBe('field')
    expect(editTarget(input, editor, false)).toBe('field')
  })
})

describe('allowedWithDialog', () => {
  it('runs every command without a dialog', () => {
    expect(allowedWithDialog('toggle-present', false)).toBe(true)
    expect(allowedWithDialog('new', false)).toBe(true)
  })
  it('behind an open dialog only lets the edit commands through', () => {
    for (const cmd of ['undo', 'redo', 'select-all'] as const)
      expect(allowedWithDialog(cmd, true)).toBe(true)
    for (const cmd of [
      'toggle-present',
      'new',
      'open',
      'close-tab',
      'export',
      'next-tab',
      'settings',
      'zoom-in',
      'insert-pagebreak',
    ] as const)
      expect(allowedWithDialog(cmd, true)).toBe(false)
  })
})
