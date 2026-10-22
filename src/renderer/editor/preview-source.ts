import { type EditorState, StateEffect, StateField } from '@codemirror/state'
import { readFlatYaml } from '../../core/flat-yaml'
import {
  MEMO_PREVIEW,
  type PreviewBlock,
  type PreviewSpec,
  parsePreviewSpec,
  resolveBlocks,
} from '../../core/preview-spec'
import type { PreviewInputs } from '../../shared/types'
import { frontmatterRange } from './frontmatter'

/** What a tab's preview blocks are described by: its set's description, profile and signature. */
export interface PreviewSource {
  set: string
  spec: PreviewSpec
  profile: Record<string, string>
  signature: string | null
}

export const setPreviewSource = StateEffect.define<PreviewSource | null>()

/** Per tab (state), so switching tabs never shows another note's set; null = built-in memo. */
export const previewSource = StateField.define<PreviewSource | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPreviewSource)) value = e.value
    return value
  },
})

const SIGNATURE_PREFIX = 'data:image/svg+xml;base64,'

/**
 * The signature as an `<img src>`, or null. Main only ever sends an SVG data URL; checked again
 * here so nothing else (a remote URL, `javascript:`) can reach the DOM.
 */
export function safeSignature(signature: string | null | undefined): string | null {
  return typeof signature === 'string' && signature.startsWith(SIGNATURE_PREFIX) ? signature : null
}

/** problem: the German notice text for a broken description, else null. */
export function previewSourceFrom(inputs: PreviewInputs | null): {
  source: PreviewSource | null
  problem: string | null
} {
  if (!inputs || inputs.set === '') return { source: null, problem: null }
  const { set, profile, signature } = inputs
  if (inputs.preview === null) {
    return { source: { set, spec: MEMO_PREVIEW, profile, signature }, problem: null }
  }
  const parsed = parsePreviewSpec(inputs.preview)
  if (parsed.ok) return { source: { set, spec: parsed.spec, profile, signature }, problem: null }
  // A broken description never breaks the editor: memo's blocks, with the set's CSS still applied.
  return {
    source: { set, spec: MEMO_PREVIEW, profile, signature },
    problem: `Die Vorschau-Beschreibung des Sets ${set} ist fehlerhaft (${parsed.error}); die Vorschau zeigt den Standard-Titelblock.`,
  }
}

/** The note's head or foot blocks, resolved from its closed front matter (none → []). */
export function noteBlocks(
  state: EditorState,
  part: 'head' | 'foot',
  today: Date = new Date(),
): PreviewBlock[] {
  const range = frontmatterRange(state.doc)
  if (!range) return []
  // The lines between the fences, as source text (readFlatYaml strips a trailing \r itself).
  const body = state.doc.sliceString(range.from, range.to).split('\n').slice(1, -1).join('\n')
  const source = state.field(previewSource, false) ?? null
  return resolveBlocks((source?.spec ?? MEMO_PREVIEW)[part], {
    fm: readFlatYaml(body),
    profile: source?.profile ?? {},
    today,
    signature: safeSignature(source?.signature) !== null,
  })
}
