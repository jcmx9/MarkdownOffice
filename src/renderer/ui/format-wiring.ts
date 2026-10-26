import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { MenuCommand, Mode } from '../../shared/types'
import {
  activeFormats,
  type FormatId,
  insertAlert,
  insertLink,
  setLinePrefix,
  toggleInline,
} from '../editor/format'
import { isFrozen } from '../editor/setup'
import {
  insertTable,
  tableColDelete,
  tableColRight,
  tableCommandState,
  tableRowBelow,
  tableRowDelete,
} from '../editor/table-edit'
import type { EditTarget } from './edit-target'
import type { ToolbarAction, ToolbarState } from './toolbar'

/**
 * The glue between the formatting toolbar / „Format“ menu and the pure commands (format.ts,
 * table-edit.ts), kept out of App so the rules are testable without a window (spec section 1
 * „Where commands act“, section 2 „Wiring in App“). A toolbar click and its menu command end in
 * the same runFormatAction.
 */

/** What App runs for a format: every toolbar action but the page break (insert-pagebreak). */
export type FormatAction = Exclude<ToolbarAction, { kind: 'pagebreak' }>

const MENU_ACTIONS: ReadonlyMap<MenuCommand, FormatAction> = new Map<MenuCommand, FormatAction>([
  ...(
    [
      'bold',
      'italic',
      'strike',
      'mark',
      'code',
      'h1',
      'h2',
      'h3',
      'bullet',
      'numbered',
      'task',
      'quote',
      'link',
    ] as const
  ).map((id): [MenuCommand, FormatAction] => [`format-${id}`, { kind: 'format', id }]),
  ...(['note', 'tip', 'important', 'warning', 'caution'] as const).map(
    (type): [MenuCommand, FormatAction] => [`insert-alert-${type}`, { kind: 'alert', type }],
  ),
  ...(['row-below', 'col-right', 'row-delete', 'col-delete'] as const).map(
    (op): [MenuCommand, FormatAction] => [`table-${op}`, { kind: 'table', op }],
  ),
])

/**
 * The menu commands that edit the document through the toolbar's commands. Editor-only: ignored
 * while a text field has focus, dropped behind a dialog (not in edit-target's DIALOG_COMMANDS),
 * ignored on a profile tab and in Present. insert-table asks for its size first.
 */
export const FORMAT_COMMANDS: ReadonlySet<MenuCommand> = new Set<MenuCommand>([
  ...MENU_ACTIONS.keys(),
  'insert-table',
])

/** The toolbar action behind a menu command; null for insert-table (size from the dialog). */
export function formatAction(cmd: MenuCommand): FormatAction | null {
  return MENU_ACTIONS.get(cmd) ?? null
}

/** Which tab is shown: none, a Markdown note, or a profile (YAML) file. */
export type Shown = 'none' | 'markdown' | 'profile'

export interface FormatContext {
  /** The window is closing: nothing may change a document. */
  closing: boolean
  mode: Mode
  shown: Shown
  /**
   * editTarget() for a menu command; 'toolbar' for a click on the toolbar, which is aimed at the
   * document whatever had focus (the buttons never take it, a modal dialog blocks the click).
   */
  target: EditTarget | 'toolbar'
}

/**
 * Whether a format command acts. Silent refusals all of them (spec „Where commands act“): a
 * focused text field keeps its own typing (unlike undo, nothing is forwarded to it), an open
 * dialog must not edit the document behind it, Present has no toolbar and no format
 * accelerators, a profile is YAML (its toolbar is shown disabled).
 */
export function formatShown(ctx: FormatContext): boolean {
  if (ctx.closing || ctx.mode === 'present' || ctx.shown !== 'markdown') return false
  return ctx.target === 'editor' || ctx.target === 'toolbar'
}

/** Runs one action on the view; false when the command refused (nothing changed). */
export function runFormatAction(
  view: EditorView,
  action: FormatAction,
  clipboardText: string | null = null,
): boolean {
  switch (action.kind) {
    case 'format':
      return formatCommand(action.id, view, clipboardText)
    case 'alert':
      return insertAlert(action.type)(view)
    case 'table-insert':
      return insertTable(view, action.cols, action.rows)
    case 'table':
      return TABLE_COMMANDS[action.op](view)
  }
}

const TABLE_COMMANDS = {
  'row-below': tableRowBelow,
  'col-right': tableColRight,
  'row-delete': tableRowDelete,
  'col-delete': tableColDelete,
} as const

function formatCommand(id: FormatId, view: EditorView, clipboardText: string | null): boolean {
  switch (id) {
    case 'bold':
    case 'italic':
    case 'strike':
    case 'mark':
    case 'code':
      return toggleInline(id)(view)
    case 'link':
      // insertLink takes the clipboard text only when it is a single http(s) URL.
      return insertLink(view, clipboardText)
    default:
      return setLinePrefix(id)(view)
  }
}

export interface ToolbarInput {
  mode: Mode
  /** The user's toggle (session `toolbar.edit`). */
  on: boolean
  shown: Shown
  /** The shown tab's editor state; null without a tab. */
  state: EditorState | null
}

const NO_TABLE = { inTable: false, rowDelete: false, colDelete: false }

/**
 * The toolbar's state (spec „Placement“, „Active state“): shown in Edit mode with a tab shown
 * and the toggle on; on a profile tab or while the editor is frozen (closing) shown with every
 * button disabled, so the row does not jump on tab switches. Active state is read only when the
 * buttons can act.
 */
export function toolbarState(i: ToolbarInput): ToolbarState {
  const visible = i.mode === 'edit' && i.on && i.shown !== 'none' && i.state !== null
  const enabled = visible && i.shown === 'markdown' && i.state !== null && !isFrozen(i.state)
  if (!enabled || !i.state) return { visible, enabled: false, active: new Set(), table: NO_TABLE }
  return {
    visible,
    enabled,
    active: activeFormats(i.state),
    table: tableCommandState(i.state),
  }
}

/**
 * Runs `run` at most once per animation frame however often `schedule()` is called; `now()`
 * runs it at once and drops the pending frame. The toolbar's active state reads the syntax tree
 * per cursor move, so a burst of transactions (typing, a drag) costs one read per frame.
 */
export class FrameThrottle {
  private pending = false

  constructor(
    private readonly run: () => void,
    private readonly frame: (cb: FrameRequestCallback) => number = (cb) =>
      requestAnimationFrame(cb),
  ) {}

  schedule(): void {
    if (this.pending) return
    this.pending = true
    this.frame(() => {
      if (!this.pending) return
      this.pending = false
      this.run()
    })
  }

  now(): void {
    this.pending = false
    this.run()
  }
}

/**
 * The clipboard text for „Link“, read only on that click (spec „Link“): Electron's default
 * permission grant lets the renderer read it; any failure means no URL, never an error.
 */
export async function readClipboardText(
  read: () => Promise<string> = () => navigator.clipboard.readText(),
): Promise<string | null> {
  try {
    return await read()
  } catch (e) {
    console.warn('clipboard read failed', e)
    return null
  }
}
