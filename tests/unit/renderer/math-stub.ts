import type { MathItem } from '../../../src/core/math'
import type { MathEntry, MathService } from '../../../src/renderer/editor/math-render'

const SVG_NS = 'http://www.w3.org/2000/svg'
export const keyOf = (item: MathItem): string => `${item.display ? 'D' : 'I'}:${item.tex}`

/** A sanitised formula as the service caches it: prefixed ids, unitless viewBox size. */
export function okEntry(prefix = 'mdo-mxT', width = 0.6, height = 0.8, depth = 0.1): MathEntry {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
  svg.setAttribute('viewBox', '0 0 6 8')
  svg.setAttribute('width', '6')
  svg.setAttribute('height', '8')
  const symbol = document.createElementNS(SVG_NS, 'symbol')
  symbol.setAttribute('id', `${prefix}-g1`)
  const use = document.createElementNS(SVG_NS, 'use')
  use.setAttribute('href', `#${prefix}-g1`)
  svg.append(symbol, use)
  return { state: 'ok', svg, prefix, width, height, depth }
}

export interface Stub extends MathService {
  entries: Map<string, MathEntry>
  /** Every request call's keys. */
  requests: string[][]
  emit(): void
}

/** A formula service with fixed entries; `emit()` tells the listeners as a settled batch would. */
export function stubService(entries: Record<string, MathEntry> = {}): Stub {
  const map = new Map(Object.entries(entries))
  const listeners = new Set<() => void>()
  const requests: string[][] = []
  return {
    entries: map,
    requests,
    get: (item) => map.get(keyOf(item)) ?? { state: 'pending' },
    request: (items) => {
      requests.push(items.map(keyOf))
    },
    onUpdate: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    emit: () => {
      for (const cb of listeners) cb()
    },
  }
}
