import type { MenuCommand } from '../../shared/types'

/** Where a menu edit command goes: the editor, a focused text field, or nowhere (dialog open). */
export type EditTarget = 'editor' | 'field' | 'blocked'

export function editTarget(
  active: Element | null,
  editorDom: Element,
  dialogOpen: boolean,
): EditTarget {
  const field =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.isContentEditable && !editorDom.contains(active))
  if (field) return 'field'
  // A modal dialog with focus on a button must not edit the document behind it.
  return dialogOpen ? 'blocked' : 'editor'
}

/** Menu commands an open modal dialog lets through: the edit commands for its fields. */
const DIALOG_COMMANDS: ReadonlySet<MenuCommand> = new Set<MenuCommand>([
  'undo',
  'redo',
  'select-all',
])

/**
 * Whether a menu command (or its accelerator) may run. Behind a modal dialog only the edit
 * commands do; anything else (Present, new tab, export …) would act under the dialog.
 */
export function allowedWithDialog(cmd: MenuCommand, dialogOpen: boolean): boolean {
  return !dialogOpen || DIALOG_COMMANDS.has(cmd)
}
