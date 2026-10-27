import type { AppUpdateCheck, MdoApi } from '../../shared/types'
import { remoteMessage } from '../util/remote-error'
import type { NoticeAction } from './notices'

/** Banner key: a newer check replaces the banner of an older one. */
export const UPDATE_KEY = 'app-update'
/** The automatic check waits a little, so the start (notes, fonts) is not slowed by it. */
export const AUTO_CHECK_DELAY_MS = 5000

type Api = Pick<
  MdoApi,
  'checkAppUpdate' | 'skipAppUpdate' | 'installAppUpdate' | 'appUpdateOutcome' | 'showAppUpdateLog'
>

export interface UpdateNotices {
  toast(message: string): void
  banner(message: string, actions: NoticeAction[], key?: string): void
}

export interface AppUpdateUiDeps {
  mdo: Api
  notices: UpdateNotices
  /** „Was ist neu?“: the release page through the checked link opener. */
  openLink(url: string): void
  /** Clients watch Present: a banner waits until it ends (`flush`). */
  presenting(): boolean
}

/**
 * The renderer side of the app update (main/app-update.ts): the banner for a newer release,
 * the menu's manual check and, at start, what became of the last install.
 */
export class AppUpdateUi {
  private held: Extract<AppUpdateCheck, { kind: 'available' }> | null = null

  constructor(private readonly d: AppUpdateUiDeps) {}

  /** At start: the outcome of the last install, then (after a pause) the automatic check. */
  async start(schedule: (run: () => void, ms: number) => void = setTimeout): Promise<void> {
    try {
      const o = await this.d.mdo.appUpdateOutcome()
      if (o?.kind === 'updated')
        this.d.notices.toast(`Markdown Office wurde auf ${o.version} aktualisiert.`)
      else if (o?.kind === 'failed')
        this.d.notices.banner(
          `Das Update auf ${o.version} ist fehlgeschlagen; die bisherige Version läuft weiter.`,
          [
            { label: 'Protokoll zeigen', run: () => void this.d.mdo.showAppUpdateLog() },
            { label: 'Schließen', run: () => undefined },
          ],
          UPDATE_KEY,
        )
    } catch (err) {
      console.warn('app update: outcome unavailable', err)
    }
    schedule(() => void this.check(false), AUTO_CHECK_DELAY_MS)
  }

  /** manual: from the menu, answers every result; automatic only shows a newer version. */
  async check(manual: boolean): Promise<void> {
    let r: AppUpdateCheck
    try {
      r = await this.d.mdo.checkAppUpdate(manual)
    } catch (err) {
      r = { kind: 'failed', message: remoteMessage(err) }
    }
    if (r.kind === 'available') return this.offer(r, manual)
    if (!manual) {
      if (r.kind === 'failed') console.warn('app update: check failed', r.message)
      return
    }
    if (r.kind === 'current') this.d.notices.toast(`Markdown Office ${r.version} ist aktuell.`)
    else if (r.kind === 'unsupported')
      this.d.notices.toast('Diese Version (Entwicklungsstand) sucht nicht nach Updates.')
    else if (r.kind === 'failed')
      this.d.notices.toast(`Suche nach Updates fehlgeschlagen: ${r.message}`)
  }

  /** Present ended: a banner held back during it is shown now. */
  flush(): void {
    const r = this.held
    this.held = null
    if (r) this.offer(r, false)
  }

  private offer(r: Extract<AppUpdateCheck, { kind: 'available' }>, manual: boolean): void {
    if (!manual && this.d.presenting()) {
      this.held = r
      return
    }
    const actions: NoticeAction[] = []
    if (r.canInstall)
      actions.push({ label: 'Jetzt aktualisieren', run: () => void this.install(r.version) })
    actions.push(
      { label: 'Was ist neu?', run: () => this.d.openLink(r.url) },
      { label: 'Später', run: () => undefined },
      { label: 'Diese Version überspringen', run: () => void this.d.mdo.skipAppUpdate(r.version) },
    )
    const how = r.canInstall
      ? ''
      : ' Diese Installation aktualisiert sich nicht selbst; bitte den Installationsbefehl erneut ausführen.'
    this.d.notices.banner(`Markdown Office ${r.version} ist verfügbar.${how}`, actions, UPDATE_KEY)
  }

  private async install(version: string): Promise<void> {
    this.d.notices.toast(`Lade Markdown Office ${version} …`)
    try {
      const error = await this.d.mdo.installAppUpdate(version)
      if (error) this.d.notices.toast(error)
    } catch (err) {
      this.d.notices.toast(`Update nicht möglich: ${remoteMessage(err)}`)
    }
  }
}
