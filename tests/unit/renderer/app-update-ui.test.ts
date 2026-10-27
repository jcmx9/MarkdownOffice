import { describe, expect, it, vi } from 'vitest'
import { AppUpdateUi, AUTO_CHECK_DELAY_MS, UPDATE_KEY } from '../../../src/renderer/ui/app-update'
import type { NoticeAction } from '../../../src/renderer/ui/notices'
import type { AppUpdateCheck } from '../../../src/shared/types'

const available = (canInstall = true): AppUpdateCheck => ({
  kind: 'available',
  version: '26.10.7',
  url: 'https://github.com/jcmx9/MarkdownOffice/releases/tag/v26.10.7',
  canInstall,
})

function setup(result: AppUpdateCheck, o: { presenting?: boolean } = {}) {
  const banners: { message: string; actions: NoticeAction[]; key?: string }[] = []
  const toasts: string[] = []
  let presenting = o.presenting ?? false
  const mdo = {
    checkAppUpdate: vi.fn(async () => result),
    skipAppUpdate: vi.fn(async () => undefined),
    installAppUpdate: vi.fn(async (): Promise<string | null> => null),
    appUpdateOutcome: vi.fn(async () => null),
    showAppUpdateLog: vi.fn(async () => undefined),
  }
  const openLink = vi.fn()
  const ui = new AppUpdateUi({
    mdo,
    notices: {
      toast: (m) => toasts.push(m),
      banner: (message, actions, key) => banners.push({ message, actions, key }),
    },
    openLink,
    presenting: () => presenting,
  })
  const action = (label: string) => banners.at(-1)?.actions.find((a) => a.label === label)
  return {
    ui,
    mdo,
    banners,
    toasts,
    openLink,
    action,
    setPresenting: (v: boolean) => (presenting = v),
  }
}

describe('AppUpdateUi', () => {
  it('offers a newer version with all four buttons', async () => {
    const t = setup(available())
    await t.ui.check(false)
    expect(t.banners).toHaveLength(1)
    expect(t.banners[0]?.message).toBe('Markdown Office 26.10.7 ist verfügbar.')
    expect(t.banners[0]?.key).toBe(UPDATE_KEY)
    expect(t.banners[0]?.actions.map((a) => a.label)).toEqual([
      'Jetzt aktualisieren',
      'Was ist neu?',
      'Später',
      'Diese Version überspringen',
    ])
    t.action('Was ist neu?')?.run()
    expect(t.openLink).toHaveBeenCalledWith(
      'https://github.com/jcmx9/MarkdownOffice/releases/tag/v26.10.7',
    )
    t.action('Diese Version überspringen')?.run()
    expect(t.mdo.skipAppUpdate).toHaveBeenCalledWith('26.10.7')
    t.action('Jetzt aktualisieren')?.run()
    await vi.waitFor(() => expect(t.mdo.installAppUpdate).toHaveBeenCalledWith('26.10.7'))
  })

  it('without a bootstrap install: no install button, a hint instead', async () => {
    const t = setup(available(false))
    await t.ui.check(true)
    expect(t.banners[0]?.actions.map((a) => a.label)).not.toContain('Jetzt aktualisieren')
    expect(t.banners[0]?.message).toMatch(/Installationsbefehl erneut ausführen/)
  })

  it('shows an install error as toast', async () => {
    const t = setup(available())
    t.mdo.installAppUpdate.mockResolvedValue('Update nicht möglich: offline')
    await t.ui.check(false)
    t.action('Jetzt aktualisieren')?.run()
    await vi.waitFor(() => expect(t.toasts).toContain('Update nicht möglich: offline'))
  })

  it('automatic check stays silent unless there is something new', async () => {
    for (const r of [
      { kind: 'current', version: '26.10.6' },
      { kind: 'skipped' },
      { kind: 'unsupported' },
      { kind: 'failed', message: 'offline' },
    ] as AppUpdateCheck[]) {
      const t = setup(r)
      await t.ui.check(false)
      expect(t.banners).toHaveLength(0)
      expect(t.toasts).toHaveLength(0)
    }
  })

  it('manual check answers every result', async () => {
    const cases: [AppUpdateCheck, string][] = [
      [{ kind: 'current', version: '26.10.6' }, 'Markdown Office 26.10.6 ist aktuell.'],
      [{ kind: 'failed', message: 'offline' }, 'Suche nach Updates fehlgeschlagen: offline'],
      [{ kind: 'unsupported' }, 'Diese Version (Entwicklungsstand) sucht nicht nach Updates.'],
    ]
    for (const [r, text] of cases) {
      const t = setup(r)
      await t.ui.check(true)
      expect(t.toasts).toEqual([text])
    }
  })

  it('holds the automatic banner during Present and shows it afterwards', async () => {
    const t = setup(available(), { presenting: true })
    await t.ui.check(false)
    expect(t.banners).toHaveLength(0)
    t.setPresenting(false)
    t.ui.flush()
    expect(t.banners).toHaveLength(1)
    t.ui.flush()
    expect(t.banners).toHaveLength(1)
  })

  it('start: reports the last install and schedules the automatic check', async () => {
    const t = setup(available())
    t.mdo.appUpdateOutcome.mockResolvedValue({ kind: 'updated', version: '26.10.7' } as never)
    const schedule = vi.fn()
    await t.ui.start(schedule)
    expect(t.toasts).toEqual(['Markdown Office wurde auf 26.10.7 aktualisiert.'])
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), AUTO_CHECK_DELAY_MS)
    schedule.mock.calls[0]?.[0]()
    await vi.waitFor(() => expect(t.mdo.checkAppUpdate).toHaveBeenCalledWith(false))
  })

  it('start: a failed install shows a banner with the log', async () => {
    const t = setup(available())
    t.mdo.appUpdateOutcome.mockResolvedValue({
      kind: 'failed',
      version: '26.10.7',
      log: '/u/update.log',
    } as never)
    await t.ui.start(() => undefined)
    expect(t.banners[0]?.message).toMatch(/Update auf 26\.10\.7 ist fehlgeschlagen/)
    t.action('Protokoll zeigen')?.run()
    expect(t.mdo.showAppUpdateLog).toHaveBeenCalled()
  })
})
