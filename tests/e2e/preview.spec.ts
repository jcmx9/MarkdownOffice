import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, test, waitForFile } from './helpers'

const FIXTURE = join(__dirname, '..', 'fixtures', 'preview.md')

async function openFixture(extra: { env?: Record<string, string> } = {}) {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Kickoff.md')
  await copyFile(FIXTURE, note)
  const launched = await launch({ dirs, args: [note], ...extra })
  await launched.page.locator('.cm-editor.mdo-preview').waitFor()
  return { ...launched, note, original: await readFile(note) }
}

test('renders the PDF look', async () => {
  const { app, page } = await openFixture()
  await expect(page.locator('.cm-line.mdo-h1')).toHaveCount(1)
  await expect(page.locator('.cm-line.mdo-h2')).toHaveCount(1)
  await expect(page.locator('.mdo-task')).toHaveCount(2)
  await expect(page.locator('.mdo-alert-title')).toHaveText('Hinweis')
  await expect(page.locator('table.mdo-table thead th')).toHaveText(['Produkt', 'Menge', 'Preis'])
  await expect(page.locator('table.mdo-table tbody tr').nth(1)).toHaveClass(/mdo-table-stripe/)
  await expect(page.locator('table.mdo-table tbody tr').first().locator('td').nth(2)).toHaveClass(
    /mdo-al-right/,
  )
  await expect(page.locator('.cm-line.mdo-codeblock').first()).toBeVisible()
  // The memo set uses par(justify: true); the editor justifies without hyphenation on every OS.
  const body = page.locator('.cm-line', { hasText: 'Ein Absatz mit' })
  await expect(body).toHaveCSS('text-align', 'justify')
  await expect(body).toHaveCSS('hyphens', 'manual')
  await expect(page.locator('.cm-line.mdo-h1')).toHaveCSS('text-align', 'left')
  await shot(page, 'preview')
  await app.close()
})

test('a checkbox click changes exactly one byte on disk', async () => {
  const { app, page, note, original } = await openFixture()
  await page.locator('.mdo-task').first().click()
  const after = await waitForFile(note, (b) => !b.equals(original))
  expect(after.length).toBe(original.length)
  const diffs = [...after].map((byte, i) => (byte === original[i] ? -1 : i)).filter((i) => i >= 0)
  expect(diffs).toHaveLength(1)
  expect(String.fromCharCode(after[diffs[0] as number] as number)).toBe('x')
  await app.close()
})

test('a table click switches to Markdown editing and back, bytes untouched', async () => {
  const { app, page, note, original } = await openFixture()
  await page.locator('table.mdo-table').click()
  await expect(page.locator('table.mdo-table')).toHaveCount(0)
  await expect(page.locator('.cm-line.mdo-table-head')).toBeVisible()
  await shot(page, 'table-editing')
  await page.locator('.cm-line.mdo-h1').click()
  await expect(page.locator('table.mdo-table')).toHaveCount(1)
  await page.waitForTimeout(1500)
  expect((await readFile(note)).equals(original)).toBe(true)
  await app.close()
})

test('the YAML header collapses, stays collapsed after restart, disk untouched', async () => {
  const first = await openFixture()
  await clickMenu(first.app, 'toggle-header')
  await expect(first.page.locator('.mdo-titleblock .mdo-tb-title')).toHaveText(
    'Kickoff Kaffeerösterei',
  )
  await expect(first.page.locator('.mdo-titleblock .mdo-tb-toptitle')).toHaveText('Muster GmbH')
  await expect(first.page.locator('.mdo-titleblock .mdo-tb-subtitle')).toHaveText('Protokoll')
  await expect(first.page.locator('.mdo-titleblock .mdo-tb-meta')).toHaveText(
    '14. Oktober 2026 · Anna',
  )
  await expect(first.page.locator('.cm-line.mdo-frontmatter')).toHaveCount(0)
  await first.page.waitForTimeout(1500)
  expect((await readFile(first.note)).equals(first.original)).toBe(true)
  await shot(first.page, 'preview-header-hidden')
  await first.app.close()
  const second = await launch({ dirs: first })
  await expect(second.page.locator('.mdo-titleblock')).toBeVisible()
  await second.app.close()
})

test('code/preview switch keeps the bytes and survives a restart', async () => {
  const first = await openFixture()
  await clickMenu(first.app, 'toggle-view')
  await expect(first.page.locator('.cm-editor.mdo-code')).toBeVisible()
  await expect(first.page.locator('.cm-lineNumbers')).toBeVisible()
  await shot(first.page, 'code')
  await first.page.waitForTimeout(1500)
  expect((await readFile(first.note)).equals(first.original)).toBe(true)
  await first.app.close()
  const second = await launch({ dirs: first })
  await expect(second.page.locator('.cm-editor.mdo-code')).toBeVisible()
  await clickMenu(second.app, 'toggle-view')
  await expect(second.page.locator('.cm-editor.mdo-preview')).toBeVisible()
  await second.app.close()
})

test('fold all hides section bodies, unfold all brings them back', async () => {
  const { app, page } = await openFixture()
  const body = page.locator('.cm-line', { hasText: 'Text unter drei Rauten' })
  await expect(body).toHaveCount(1)
  await clickMenu(app, 'fold-all')
  await expect(page.locator('.cm-foldPlaceholder').first()).toBeVisible()
  await expect(body).toHaveCount(0)
  await clickMenu(app, 'unfold-all')
  await expect(body).toHaveCount(1)
  await app.close()
})

test('loads the bundled fonts', async () => {
  const { app, page } = await openFixture()
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts]
      .filter((f) => f.status === 'loaded')
      .map((f) => f.family.replace(/"/g, ''))
  })
  expect(loaded).toEqual(expect.arrayContaining(['mdo Sans', 'mdo Serif']))
  await app.close()
})

test('clicks and arrow keys hit the right line below the title block and a table', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Zeilen.md')
  await writeFile(
    note,
    '---\ntitle: Titel\nsubtitle: Untertitel\n---\n# Agenda\n1. Erstens\n2. Zweitens\n3. Drittens\n\n|a|b|\n|---|---|\n|1|2|\n\nVorletzte\nEnde\n',
  )
  // Zoom 2 as in the reported case: CodeMirror's height map must not drift from the layout.
  await writeFile(
    join(dirs.userData, 'session.json'),
    JSON.stringify({
      tabs: [{ path: note, headerHidden: true }],
      activeIndex: 0,
      view: 'preview',
      zoom: { edit: 2, present: 1.25 },
    }),
  )
  const { app, page } = await launch({ dirs })
  await expect(page.locator('.mdo-titleblock')).toBeVisible()
  await page.getByText('Erstens').click()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.type('X')
  await page.getByText('Vorletzte').click()
  await page.keyboard.press('End')
  await page.keyboard.type('Y')
  const text = (await waitForFile(note, (b) => /Y/.test(b.toString()))).toString()
  const lines = text.split('\n')
  expect(lines.find((l) => l.includes('X'))).toMatch(/^2\. Zweite/)
  expect(lines.find((l) => l.includes('Y'))).toBe('VorletzteY')
  await app.close()
})

test('YAML header, code blocks and Mermaid are highlighted in both views', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Farben.md')
  await writeFile(
    note,
    [
      '---',
      'title: "Farben" # Kommentar',
      'toc: auto',
      '---',
      '',
      '```js',
      'const answer = 42 // Kommentar',
      '```',
      '',
      '```mermaid',
      'flowchart LR',
      '  A[Start] --> B[Ende]',
      '```',
      '',
    ].join('\n'),
  )
  const { app, page } = await launch({ dirs, args: [note] })
  await page.locator('.cm-editor.mdo-preview').waitFor()
  // The header may start collapsed: show it.
  if ((await page.locator('.cm-line', { hasText: 'toc: auto' }).count()) === 0) {
    await clickMenu(app, 'toggle-header')
  }
  // JavaScript is loaded on demand from a separate chunk (CSP script-src 'self').
  await expect(page.locator('.mdo-tok-keyword', { hasText: 'const' })).toBeVisible()
  await expect(page.locator('.mdo-tok-number', { hasText: '42' })).toBeVisible()
  await expect(page.locator('.mdo-tok-keyword', { hasText: 'flowchart' })).toBeVisible()
  await expect(page.locator('.mdo-tok-function', { hasText: '-->' })).toBeVisible()
  await expect(page.locator('.mdo-tok-function', { hasText: 'title' })).toBeVisible()
  await expect(page.locator('.mdo-tok-string', { hasText: '"Farben"' })).toBeVisible()
  await expect(page.locator('.mdo-tok-comment', { hasText: '# Kommentar' })).toBeVisible()
  await shot(page, 'highlight-preview')
  await clickMenu(app, 'toggle-view')
  await page.locator('.cm-editor.mdo-code').waitFor()
  await expect(page.locator('.mdo-tok-keyword', { hasText: 'const' })).toBeVisible()
  await expect(page.locator('.mdo-tok-function', { hasText: 'title' })).toBeVisible()
  await shot(page, 'highlight-code')
  await app.close()
})

test('external links get an underline and a ↗ that is not document text', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Links.md')
  const source =
    'Siehe [Doku](https://example.com/doku) und [Kapitel](#kapitel), Quelle [21].\n\n' +
    '| Verweis | Art |\n|---|---|\n| [Tabelle](https://example.com/t) | extern [1], [2] |\n\nEnde\n'
  await writeFile(note, source)
  const { app, page } = await launch({ dirs, args: [note] })
  await page.locator('.cm-editor.mdo-preview').waitFor()
  const line = page.locator('.cm-line', { hasText: 'Siehe' })
  const ext = line.locator('.mdo-link-ext')
  await expect(ext).toHaveText('Doku')
  // No colour of its own: the link keeps the text colour of its line, only the underline marks it.
  expect(await ext.evaluate((el) => getComputedStyle(el).color)).toBe(
    await line.evaluate((el) => getComputedStyle(el).color),
  )
  await expect(ext).toHaveCSS('text-decoration-style', 'solid')
  // Internal link: plain link look, no arrow.
  await expect(line.locator('.mdo-link:not(.mdo-link-ext)')).toHaveText('Kapitel')
  // A citation without a reference definition is text (CommonMark, as in the PDF): brackets stay.
  await expect(line).toContainText('Quelle [21].')
  const arrows = line.locator('.mdo-link-arrow')
  await expect(arrows).toHaveCount(1)
  const arrow = await arrows.first().evaluate((el) => ({
    glyph: getComputedStyle(el, '::before').content,
    text: el.textContent,
    inLink: el.closest('.mdo-link') !== null,
  }))
  // The glyph comes from CSS: the widget has no text and sits after, not inside, the link
  // (so the underline stops before it).
  expect(arrow).toEqual({ glyph: '"↗"', text: '', inLink: false })
  // Table widget (cursor elsewhere): the same marker.
  await expect(page.locator('table.mdo-table .mdo-link-ext')).toHaveText('Tabelle')
  await expect(page.locator('table.mdo-table .mdo-link-arrow')).toHaveCount(1)
  await expect(page.locator('table.mdo-table td').nth(1)).toHaveText('extern [1], [2]')
  expect(await page.locator('.cm-content').textContent()).not.toContain('↗')
  await shot(page, 'links-preview')
  // Code view: raw source, no marker.
  await clickMenu(app, 'toggle-view')
  await page.locator('.cm-editor.mdo-code').waitFor()
  await expect(page.locator('.mdo-link-arrow')).toHaveCount(0)
  await page.waitForTimeout(1500)
  expect((await readFile(note)).toString()).toBe(source)
  await app.close()
})

test('heading gaps match the memo PDF, the same with or without blank lines', async () => {
  const body = [
    'Absatz oben.',
    '# Kapitel',
    'Absatz eins.',
    '## Mitte',
    'Absatz zwei.',
    '### Klein',
    'Absatz Ende.',
  ]
  // Baseline-to-baseline distances in pt at body 10pt, measured in the memo set's PDF of
  // this note: [above, below] per heading (H1 below includes its hairline).
  const pdf: Array<[string, number, number]> = [
    ['.mdo-h1', 37.4, 33.0],
    ['.mdo-h2', 26.0, 15.0],
    ['.mdo-h3', 19.2, 12.1],
  ]
  const measure = async (sep: string, name: string) => {
    const dirs = await makeDirs()
    const note = join(dirs.notes, `${name}.md`)
    await writeFile(note, `${body.join(sep)}\n`)
    const { app, page } = await launch({ dirs, args: [note] })
    await page.locator('.cm-editor.mdo-preview').waitFor()
    await expect(page.locator('.cm-line.mdo-h3')).toHaveCount(1)
    await page.evaluate(() => document.fonts.ready)
    const dists = await page.evaluate(
      (sels) => {
        // Text box bottom = baseline + descent (hhea): Source Serif 0.335em, Source Sans 0.326em.
        const baseline = (el: Element, descent: number) => {
          const r = document.createRange()
          r.selectNodeContents(el)
          return (
            r.getBoundingClientRect().bottom - descent * parseFloat(getComputedStyle(el).fontSize)
          )
        }
        const para = (t: string) => {
          const el = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent === t)
          if (!el) throw new Error(`line ${t} missing`)
          return { el, y: baseline(el, 0.326) }
        }
        // Normalise to body 10pt whatever the zoom: px per pt of the body text.
        const unit = parseFloat(getComputedStyle(para('Absatz oben.').el).fontSize) / 10
        const order = ['Absatz oben.', 'Absatz eins.', 'Absatz zwei.', 'Absatz Ende.']
        return sels.map((sel, i) => {
          const h = baseline(document.querySelector(`.cm-line${sel}`) as Element, 0.335)
          return {
            above: (h - para(order[i] as string).y) / unit,
            below: (para(order[i + 1] as string).y - h) / unit,
          }
        })
      },
      pdf.map(([sel]) => sel),
    )
    await shot(page, `heading-spacing-${name}`)
    await app.close()
    return dists
  }
  const tight = await measure('\n', 'tight')
  const blank = await measure('\n\n', 'blank')
  for (const [i, [, above, below]] of pdf.entries()) {
    const t = tight[i] as (typeof tight)[number]
    const b = blank[i] as (typeof blank)[number]
    // Blank lines next to a heading do not change the layout.
    expect(Math.abs(t.above - b.above)).toBeLessThanOrEqual(1)
    expect(Math.abs(t.below - b.below)).toBeLessThanOrEqual(1)
    // Within 1pt of the PDF.
    expect(Math.abs(t.above - above)).toBeLessThanOrEqual(1)
    expect(Math.abs(t.below - below)).toBeLessThanOrEqual(1)
  }
})

test('text and tables are as wide as the memo PDF text block (145 mm)', async () => {
  const { app, page } = await openFixture()
  await page.evaluate(() => document.fonts.ready)
  const widths = await page.evaluate(() => {
    // Content box: the width the text actually breaks in (CodeMirror pads lines and content).
    const box = (el: Element) => {
      const s = getComputedStyle(el)
      return (
        el.getBoundingClientRect().width -
        Number.parseFloat(s.paddingLeft) -
        Number.parseFloat(s.paddingRight)
      )
    }
    const line = [...document.querySelectorAll('.cm-line')].find((l) =>
      l.textContent?.startsWith('Ein Absatz mit'),
    )
    const table = document.querySelector('.mdo-table-wrap')
    const inner = document.querySelector('table.mdo-table')
    return {
      line: line ? box(line) : 0,
      table: table ? box(table) : 0,
      inner: inner ? inner.getBoundingClientRect().width : 0,
    }
  })
  // memo: A4 (210 mm) minus margins 35 mm + 30 mm = 145 mm = 548.0 CSS px at 100 % zoom.
  const pdf = (145 / 25.4) * 96
  expect(widths.line).toBeCloseTo(pdf, 0)
  expect(widths.table).toBeCloseTo(pdf, 0)
  // Typst's auto columns do not stretch: the small fixture table stays as wide as its content.
  expect(widths.inner).toBeGreaterThan(0)
  expect(widths.inner).toBeLessThan(pdf / 2)
  await app.close()
})

test('table columns are as wide as Typst makes them in the memo PDF', async () => {
  // Short first and last column, long text in the middle: the browser's auto layout would
  // squeeze "Objekt" and "Quelle" until they wrap; Typst's auto columns keep them whole.
  const long =
    'Einbauküche mit Induktionsfeld, Geschirrspüler und Backofen auf Arbeitshöhe, ' +
    'dazu ein raumhoher Einbauschrank im Flur und Parkett in allen Wohnräumen'
  const source = [
    '# Ausstattung',
    '',
    '| Objekt | Beschreibung | Quelle |',
    '|---|---|---|',
    `| Wohnung Erdgeschoss | ${long} | Exposé 2024 |`,
    `| Keller | ${long.slice(0, 60)} | Begehung |`,
    '',
    'Ende.',
    '',
  ].join('\n')
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Tabelle.md')
  await writeFile(note, source)
  const { app, page } = await launch({ dirs, args: [note] })
  await page.locator('.cm-editor.mdo-preview').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('table.mdo-table.mdo-table-fitted')).toHaveCount(1)
  const m = await page.evaluate(() => {
    const wrap = document.querySelector('.mdo-table-wrap') as HTMLElement
    const table = wrap.querySelector('table') as HTMLTableElement
    const s = getComputedStyle(wrap)
    const available =
      wrap.clientWidth - Number.parseFloat(s.paddingLeft) - Number.parseFloat(s.paddingRight)
    // Natural widths independently of the widget: a clone in auto layout at max-content.
    const clone = table.cloneNode(true) as HTMLTableElement
    clone.querySelector('colgroup')?.remove()
    clone.classList.remove('mdo-table-fitted')
    Object.assign(clone.style, {
      width: 'max-content',
      tableLayout: 'auto',
      position: 'absolute',
      visibility: 'hidden',
    })
    wrap.append(clone)
    const natural = [...(clone.tHead?.rows[0]?.cells ?? [])].map(
      (c) => c.getBoundingClientRect().width,
    )
    clone.remove()
    const widths = [...(table.tHead?.rows[0]?.cells ?? [])].map(
      (c) => c.getBoundingClientRect().width,
    )
    // Lines per data cell: distinct line tops of the cell's text.
    const lines = [...(table.tBodies[0]?.rows ?? [])].map((r) =>
      [...r.cells].map((c) => {
        const range = document.createRange()
        range.selectNodeContents(c)
        return new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size
      }),
    )
    return { available, natural, widths, lines }
  })
  // Typst (grid layouter shrink_auto_columns), restated here so the test checks the widget.
  const capped = m.natural.map((w) => Math.min(w, m.available))
  let fair = Number.NEGATIVE_INFINITY
  let rest = m.available
  let open = capped.length
  for (let changed = true; changed && open > 0; ) {
    changed = false
    const last = fair
    fair = rest / open
    for (const w of capped) {
      if (w <= fair && w > last) {
        rest -= w
        open--
        changed = true
      }
    }
  }
  const want = capped.map((w) => Math.min(w, fair))
  console.log('table columns', JSON.stringify({ ...m, want }))
  expect(m.natural[1] as number).toBeGreaterThan(m.available)
  for (const [i, w] of want.entries()) {
    expect(Math.abs((m.widths[i] as number) - w)).toBeLessThanOrEqual(1)
  }
  // Short columns stay one line high; only the long description wraps.
  for (const row of m.lines) {
    expect(row[0]).toBe(1)
    expect(row[2]).toBe(1)
  }
  expect(m.lines[0]?.[1] as number).toBeGreaterThan(1)
  await shot(page, 'table-columns')
  await app.close()
})
