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

describe('Notices.setBannerText', () => {
  it('changes the shown banner text and keeps its buttons; false without a banner', () => {
    const el = document.createElement('div')
    const n = new Notices(el)
    expect(n.setBannerText('app-update', '10 %')).toBe(false)
    n.banner('Lade …', [{ label: 'Abbrechen', run: () => undefined }], 'app-update')
    const button = el.querySelector('button')
    expect(n.setBannerText('app-update', 'Lade … 10 %')).toBe(true)
    expect(el.querySelector('p')?.textContent).toBe('Lade … 10 %')
    expect(el.querySelector('button')).toBe(button)
  })
})
