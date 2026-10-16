import type { EditorState, Text } from '@codemirror/state'
import type { Eol, SessionTab } from '../../shared/types'

export interface Tab {
  readonly id: number
  path: string
  state: EditorState
  /** Doc as last written to disk; dirty = state.doc differs. */
  savedDoc: Text
  bom: boolean
  eol: Eol
  /** False for a new note until its first save. */
  onDisk: boolean
  headerHidden: boolean
}

export interface NewTab {
  path: string
  state: EditorState
  bom: boolean
  eol: Eol
  onDisk: boolean
  headerHidden?: boolean
}

export class TabStore {
  private tabs: Tab[] = []
  private activeIdx = -1
  private nextId = 1

  get all(): readonly Tab[] {
    return this.tabs
  }

  get activeIndex(): number {
    return this.activeIdx
  }

  get active(): Tab | null {
    return this.tabs[this.activeIdx] ?? null
  }

  add(init: NewTab): Tab {
    const existing = this.findByPath(init.path)
    if (existing) {
      this.activeIdx = this.tabs.indexOf(existing)
      return existing
    }
    const tab: Tab = {
      id: this.nextId++,
      path: init.path,
      state: init.state,
      savedDoc: init.state.doc,
      bom: init.bom,
      eol: init.eol,
      onDisk: init.onDisk,
      headerHidden: init.headerHidden ?? false,
    }
    this.tabs.push(tab)
    this.activeIdx = this.tabs.length - 1
    return tab
  }

  get(id: number): Tab | undefined {
    return this.tabs.find((t) => t.id === id)
  }

  findByPath(path: string): Tab | undefined {
    return this.tabs.find((t) => t.path === path)
  }

  activate(index: number): Tab | null {
    if (index >= 0 && index < this.tabs.length) this.activeIdx = index
    return this.active
  }

  next(): Tab | null {
    if (!this.tabs.length) return null
    return this.activate((this.activeIdx + 1) % this.tabs.length)
  }

  prev(): Tab | null {
    if (!this.tabs.length) return null
    return this.activate((this.activeIdx - 1 + this.tabs.length) % this.tabs.length)
  }

  close(id: number): void {
    const i = this.tabs.findIndex((t) => t.id === id)
    if (i < 0) return
    this.tabs.splice(i, 1)
    if (this.tabs.length === 0) this.activeIdx = -1
    else if (i < this.activeIdx || this.activeIdx >= this.tabs.length) this.activeIdx -= 1
  }

  updateState(id: number, state: EditorState): void {
    const tab = this.get(id)
    if (tab) tab.state = state
  }

  markSaved(id: number, doc: Text): void {
    const tab = this.get(id)
    if (!tab) return
    tab.savedDoc = doc
    tab.onDisk = true
  }

  setPath(id: number, path: string): void {
    const tab = this.get(id)
    if (tab) tab.path = path
  }

  isDirty(tab: Tab): boolean {
    return !tab.state.doc.eq(tab.savedDoc)
  }

  toSession(): SessionTab[] {
    return this.tabs
      .filter((t) => t.onDisk)
      .map((t) => ({ path: t.path, headerHidden: t.headerHidden }))
  }
}
