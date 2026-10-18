import { isAbsolute, join } from 'node:path'
import { BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { Ch } from '../shared/ipc'
import type { NoteFile, RenameResult, SaveResult, SessionPatch } from '../shared/types'
import { type AppContext, logSessionError } from './context'
import {
  canonicalPath,
  canonicalPaths,
  type DiskConflict,
  diskConflict,
  hashBytes,
  newNotePath,
  noteBytes,
  readNote,
  renameNote,
  writeNoteBytes,
} from './files'
import { setWindowFullScreen } from './fullscreen'
import { readHeaderTemplate } from './header-template'
import { noteMenuTemplate } from './menu'
import { loadUserSnippets } from './snippets'
import { CODE_RE } from './spellcheck/languages'

const str = (v: unknown): string => {
  if (typeof v !== 'string') throw new TypeError('Ungültiger Parameter.')
  return v
}
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Aborts a save before its rename because the disk no longer holds the tab's base. */
class SaveConflict extends Error {}

export function registerIpc(ctx: AppContext): void {
  ipcMain.handle(Ch.startup, () => ctx.startup())
  ipcMain.handle(Ch.listSnippets, () => loadUserSnippets(ctx.settings.snippetFolder))
  ipcMain.handle(Ch.noteMenu, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    Menu.buildFromTemplate(noteMenuTemplate((c) => ctx.send(Ch.menu, c))).popup({ window: win })
  })
  ipcMain.handle(Ch.readHeaderTemplate, () =>
    readHeaderTemplate(join(ctx.pipeline.paths.sets, 'memo', 'memo.header.md')),
  )
  // Arguments come from the renderer: only short strings / plain language codes (CODE_RE) pass.
  ipcMain.handle(Ch.spellLanguage, (_e, lang: unknown) =>
    typeof lang === 'string' && lang.length <= 35
      ? (ctx.spellcheck?.setLanguage(lang) ?? null)
      : null,
  )
  ipcMain.handle(Ch.spellDownload, (_e, code: unknown) =>
    typeof code === 'string' && CODE_RE.test(code)
      ? (ctx.spellcheck?.downloadDictionary(code) ?? false)
      : false,
  )
  ipcMain.handle(
    Ch.spellCheckUpdates,
    () => ctx.spellcheck?.checkNow() ?? ({ kind: 'skipped' } as const),
  )
  // Own words: the list is read from the session; a removal argument comes from the renderer,
  // so only a string of 1-100 characters passes.
  ipcMain.handle(Ch.spellWords, () => ctx.spellcheck?.listWords() ?? [])
  ipcMain.handle(Ch.spellRemoveWord, (_e, word: unknown) =>
    typeof word === 'string' && word.length >= 1 && word.length <= 100
      ? (ctx.spellcheck?.removeWord(word) ?? false)
      : false,
  )
  ipcMain.handle(Ch.spellDecline, async (_e, code: unknown) => {
    if (typeof code === 'string' && CODE_RE.test(code))
      await ctx.spellcheck?.declineDictionary(code)
  })
  ipcMain.handle(Ch.settingsStatus, () => ctx.settingsStatus())
  ipcMain.handle(Ch.updateSettings, (_e, patch: unknown) => ctx.updateSettings(patch))

  /** Picker for the settings dialog; it only returns a path, nothing on disk is changed. */
  ipcMain.handle(
    Ch.choosePath,
    async (e, kind: unknown, current: unknown): Promise<string | null> => {
      if (kind !== 'folder') throw new TypeError('Ungültiger Parameter.')
      const win = BrowserWindow.fromWebContents(e.sender)
      const start = typeof current === 'string' && isAbsolute(current) ? current : undefined
      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: start,
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      const picked = result.canceled ? undefined : result.filePaths[0]
      return picked ? canonicalPath(picked) : null
    },
  )

  /**
   * The app only leaves a fullscreen it requested itself (FullScreenOwner); returns whether
   * the user had the window fullscreen before the request.
   */
  ipcMain.handle(Ch.setFullScreen, (e, on: unknown): Promise<boolean> | boolean => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return false
    const flag = on === true
    // macOS hides the menu bar in fullscreen itself; Windows/Linux need it hidden explicitly,
    // and shown again on leaving Present even when the user's own fullscreen stays.
    if (process.platform !== 'darwin') win.setMenuBarVisibility(!flag)
    // An enter settles when it took effect or the OS refused it (then Present stays windowed).
    return setWindowFullScreen(
      ctx.fullScreen,
      {
        isFullScreen: () => !win.isDestroyed() && win.isFullScreen(),
        setFullScreen: (set) => win.setFullScreen(set),
      },
      flag,
      () => {
        if (!win.isDestroyed()) win.webContents.send(Ch.fullScreenRefused)
      },
    )
  })

  ipcMain.handle(Ch.readNote, async (_e, path: unknown): Promise<NoteFile | { error: string }> => {
    try {
      const p = await ctx.assertAllowed(str(path))
      const note = await readNote(p)
      ctx.watcher.expect(p, note.hash)
      void ctx.rememberRecent(p).catch(logSessionError)
      return note
    } catch (err) {
      return { error: message(err) }
    }
  })

  ipcMain.handle(Ch.newNotePath, async () => {
    // Canonical folder (also when it does not exist yet), so candidates compare against the
    // canonical reserved set.
    const dir = await canonicalPath(ctx.settings.defaultFolder)
    const p = await newNotePath(dir, new Date(), ctx.reserved)
    ctx.reserved.add(p)
    ctx.allow([p])
    return p
  })

  ipcMain.handle(Ch.releasePath, async (_e, path: unknown) => {
    ctx.reserved.delete(await canonicalPath(str(path)))
  })

  /**
   * Saves only over the content the tab is based on (`base`: hash of the bytes it last loaded or
   * saved, null for a new note whose file must not exist yet) or over the app's own newer write.
   * Anything else on disk was written outside and may not have been reported yet (watcher
   * debounce): the save is refused and the disk state returned, so the renderer runs its
   * external-change flow. `force` is the user's explicit overwrite and skips the check.
   *
   * The check runs after the temp file is complete, right before the atomic rename. A write by
   * another program between that read and the rename is still replaced (residual race of a few
   * milliseconds, longer only while a rename is retried on a locked target on Windows); the
   * watcher then reports nothing, because the bytes on disk are ours.
   */
  ipcMain.handle(
    Ch.saveNote,
    async (
      _e,
      path: unknown,
      text: unknown,
      bom: unknown,
      base: unknown,
      force: unknown,
    ): Promise<SaveResult> => {
      try {
        const p = await ctx.assertAllowed(str(path))
        const baseHash = base === null || base === undefined ? null : str(base)
        const bytes = noteBytes(str(text), bom === true)
        const hash = hashBytes(bytes)
        let conflict: DiskConflict | null = null
        try {
          await writeNoteBytes(p, bytes, async () => {
            if (force !== true) {
              conflict = await diskConflict(p, baseHash, (h) => ctx.watcher.isOwn(p, h))
              if (conflict) throw new SaveConflict()
            }
            // Before the rename, so the watcher never reports our own write.
            ctx.watcher.expect(p, hash)
          })
        } catch (err) {
          const found = conflict as DiskConflict | null
          if (!(err instanceof SaveConflict) || !found) throw err
          // The renderer handles this state now; the watcher must not report it again.
          ctx.watcher.acknowledge(p, found.hash ?? null)
          // After a case-only rename outside, the tab must follow the new spelling first, or
          // the renderer would not find the tab the conflict belongs to.
          return p === path
            ? { ok: false, conflict: found.change }
            : { ok: false, conflict: found.change, path: p }
        }
        if (ctx.reserved.delete(p)) void ctx.rememberRecent(p).catch(logSessionError)
        // The note's spelling changed outside (case-only rename): the tab follows it.
        if (p !== path) {
          void ctx.renamedRecent(str(path), p).catch(logSessionError)
          return { ok: true, hash, path: p }
        }
        return { ok: true, hash }
      } catch (err) {
        return { ok: false, error: message(err) }
      }
    },
  )

  ipcMain.handle(
    Ch.renameNote,
    async (_e, from: unknown, newName: unknown): Promise<RenameResult> => {
      try {
        const p = await ctx.assertAllowed(str(from))
        const to = await canonicalPath(await renameNote(p, str(newName)))
        ctx.allow([to])
        await ctx.renamedRecent(p, to)
        return { ok: true, path: to }
      } catch (err) {
        return { ok: false, error: message(err) }
      }
    },
  )

  ipcMain.handle(Ch.openDialog, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      defaultPath: ctx.settings.defaultFolder,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    const paths = await canonicalPaths(result.filePaths)
    ctx.allow(paths)
    return paths
  })

  ipcMain.handle(Ch.exportPdf, async (_e, path: unknown) => {
    return ctx.exportPdf(await ctx.assertAllowed(str(path)))
  })

  ipcMain.handle(Ch.saveSession, async (_e, patch: unknown) => {
    if (typeof patch === 'object' && patch !== null) await ctx.updateSession(patch as SessionPatch)
  })

  // Each call sends the full list: only the newest one may reach the watcher, even when an
  // older call's canonicalisation finishes later.
  let watchGeneration = 0
  ipcMain.handle(Ch.watch, async (_e, paths: unknown) => {
    const generation = ++watchGeneration
    const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []
    const canonical = await canonicalPaths(list)
    if (generation !== watchGeneration) return
    ctx.watcher.setFiles(canonical.filter((p) => ctx.isAllowed(p)))
  })

  ipcMain.handle(Ch.confirmDiscard, (_e, names: unknown) =>
    ctx.confirmDiscard(Array.isArray(names) ? names.map(String) : []),
  )

  ipcMain.on(Ch.closeReady, (_e, ok: unknown) => ctx.closeReady(ok === true))
}
