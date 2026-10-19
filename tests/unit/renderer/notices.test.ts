// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { Notices } from '../../../src/renderer/ui/notices'

describe('Notices.dismissPrefix', () => {
  it('removes only the banners whose key has the prefix', () => {
    const el = document.createElement('div')
    const n = new Notices(el)
    n.banner('Wörterbuch für Französisch fehlt – laden?', [], 'dict-fr-FR')
    n.banner('Wörterbuch für Niederländisch fehlt – laden?', [], 'dict-nl')
    n.banner('Datei außerhalb geändert', [], 'tab:1')
    n.dismissPrefix('dict-')
    expect([...el.querySelectorAll('.banner p')].map((p) => p.textContent)).toEqual([
      'Datei außerhalb geändert',
    ])
  })
})
