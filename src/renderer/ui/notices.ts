export interface NoticeAction {
  label: string
  run(): void
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

export class Notices {
  private readonly banners = new Map<string, HTMLElement>()

  constructor(private readonly el: HTMLElement) {}

  /** Removes the banner registered under key, if any. */
  dismiss(key: string): void {
    this.banners.get(key)?.remove()
    this.banners.delete(key)
  }

  toast(message: string): void {
    const t = document.createElement('div')
    t.className = 'toast'
    t.setAttribute('role', 'status')
    t.textContent = message
    this.el.append(t)
    setTimeout(() => t.remove(), 4000)
  }

  /** Dismissible, copyable message, e.g. the pipeline's stderr. */
  panel(title: string, body: string): void {
    const p = document.createElement('div')
    p.className = 'panel'
    p.setAttribute('role', 'alertdialog')
    const h = document.createElement('h2')
    h.textContent = title
    const pre = document.createElement('pre')
    pre.textContent = body
    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(
      button('Kopieren', () => void navigator.clipboard.writeText(body)),
      button('Schließen', () => p.remove()),
    )
    p.append(h, pre, actions)
    this.el.append(p)
  }

  /**
   * A banner with the same key replaces the one already shown for that key.
   * detail: technical text shown as the message's tooltip only.
   */
  banner(message: string, actions: NoticeAction[], key?: string, detail?: string): void {
    if (key !== undefined) this.banners.get(key)?.remove()
    const b = document.createElement('div')
    b.className = 'banner'
    b.setAttribute('role', 'alert')
    const text = document.createElement('p')
    text.textContent = message
    if (detail) text.title = detail
    b.append(
      text,
      ...actions.map((a) =>
        button(a.label, () => {
          b.remove()
          if (key !== undefined && this.banners.get(key) === b) this.banners.delete(key)
          a.run()
        }),
      ),
    )
    if (key !== undefined) this.banners.set(key, b)
    this.el.append(b)
  }
}
