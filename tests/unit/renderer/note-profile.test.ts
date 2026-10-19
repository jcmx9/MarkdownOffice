import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { setNoteProfile } from '../../../src/renderer/editor/note-profile'
import { createState, serializeDoc } from '../../../src/renderer/editor/setup'

const apply = (text: string, name: string): string | null => {
  const state = EditorState.create({ doc: text })
  const spec = setNoteProfile(state, name)
  return spec ? state.update(spec).state.doc.toString() : null
}

describe('setNoteProfile', () => {
  it('replaces the value in place and keeps the comment column', () => {
    expect(
      apply('---\ntemplate: din5008a\nprofile: beispiel   # Profil\n---\nText\n', 'kanzlei'),
    ).toBe('---\ntemplate: din5008a\nprofile: kanzlei    # Profil\n---\nText\n')
  })

  it('adds the key right after template: when the note has none', () => {
    expect(apply('---\ntitle: x\ntemplate: din5008a\nlang: de\n---\n', 'kanzlei')).toBe(
      '---\ntitle: x\ntemplate: din5008a\nprofile: kanzlei\nlang: de\n---\n',
    )
  })

  it('adds it before the closing fence without template:', () => {
    expect(apply('---\ntitle: x\n---\n', 'k')).toBe('---\ntitle: x\nprofile: k\n---\n')
  })

  it('ignores nested keys and answers null for nothing to do', () => {
    expect(apply('---\ntemplate: d\nx:\n  profile: a\n---\n', 'k')).toBe(
      '---\ntemplate: d\nprofile: k\nx:\n  profile: a\n---\n',
    )
    expect(apply('---\nprofile: k\n---\n', 'k')).toBeNull()
    expect(apply('Kein Header\n', 'k')).toBeNull()
    expect(apply('---\ntemplate: d\n---\n', 'Bad Name')).toBeNull()
  })

  it('keeps CRLF notes CRLF', () => {
    const state = createState('---\r\ntemplate: d\r\n---\r\n', '\r\n', 'code')
    const spec = setNoteProfile(state, 'k')
    if (!spec) throw new Error('no change')
    expect(serializeDoc(state.update(spec).state.doc, '\r\n')).toBe(
      '---\r\ntemplate: d\r\nprofile: k\r\n---\r\n',
    )
  })

  it('keeps mixed line endings byte-exact around the new line', () => {
    const text = '---\r\ntemplate: d\r\nprofile: a\r\n---\nText'
    const state = createState(text, 'mixed', 'code')
    const spec = setNoteProfile(state, 'k')
    if (!spec) throw new Error('no change')
    expect(serializeDoc(state.update(spec).state.doc, 'mixed')).toBe(
      '---\r\ntemplate: d\r\nprofile: k\r\n---\nText',
    )
    const added = createState('---\r\ntemplate: d\r\n---\n', 'mixed', 'code')
    const add = setNoteProfile(added, 'k')
    if (!add) throw new Error('no change')
    expect(serializeDoc(added.update(add).state.doc, 'mixed')).toBe(
      '---\r\ntemplate: d\r\nprofile: k\r\n---\n',
    )
  })

  it('is one undo step', async () => {
    const { undo } = await import('@codemirror/commands')
    let state = createState('---\ntemplate: d\nprofile: a\n---\n', '\n', 'code')
    const spec = setNoteProfile(state, 'k')
    if (!spec) throw new Error('no change')
    state = state.update(spec).state
    undo({ state, dispatch: (tr) => (state = tr.state) })
    expect(state.doc.toString()).toBe('---\ntemplate: d\nprofile: a\n---\n')
  })
})
