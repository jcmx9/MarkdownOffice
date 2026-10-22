import type { PreviewBlock } from '../../core/preview-spec'
import { safeSignature } from './preview-source'

/** One block as `.mdo-tb-<cls>`; text always via textContent / text nodes, never as HTML. */
function renderBlock(b: PreviewBlock, signature: string | null, doc: Document): HTMLElement | null {
  if (b.kind === 'image') {
    const src = safeSignature(signature)
    if (!src) return null
    const img = doc.createElement('img')
    img.className = `mdo-tb-${b.cls}`
    img.alt = ''
    img.src = src
    // Print units scale with the zoom like every other length (the --mdo-scale contract).
    if (b.width) img.style.width = `calc(${b.width} * var(--mdo-scale, 1))`
    return img
  }
  const el = doc.createElement('div')
  el.className = `mdo-tb-${b.cls}`
  if (b.label !== null) {
    const label = doc.createElement('div')
    label.className = 'mdo-tb-label'
    label.textContent = b.label
    el.append(label)
  }
  if (b.kind === 'text') el.append(doc.createTextNode(b.text))
  else
    for (const text of b.lines) {
      const line = doc.createElement('div')
      line.className = 'mdo-tb-line'
      line.textContent = text
      el.append(line)
    }
  return el
}

/**
 * The head (title block replacing the front matter) or foot (after the body) of a note's
 * preview. An empty head keeps today's faint "⋯ YAML-Header" marker outside Present.
 */
export function renderBlocks(
  blocks: readonly PreviewBlock[],
  o: { part: 'head' | 'foot'; signature: string | null; empty: 'marker' | 'none'; doc?: Document },
): HTMLElement {
  const doc = o.doc ?? document
  const el = doc.createElement('div')
  if (o.part === 'head') {
    el.className = 'mdo-titleblock'
    if (o.empty !== 'none' || blocks.length) el.title = 'YAML-Header ausgeblendet'
    if (!blocks.length) {
      if (o.empty === 'none') {
        el.classList.add('mdo-titleblock-none')
        return el
      }
      el.classList.add('mdo-titleblock-empty')
      el.textContent = '⋯ YAML-Header'
      return el
    }
  } else {
    el.className = 'mdo-footblock'
    if (!blocks.length) {
      el.classList.add('mdo-footblock-none')
      return el
    }
  }
  for (const b of blocks) {
    const child = renderBlock(b, o.signature, doc)
    if (child) el.append(child)
  }
  return el
}
