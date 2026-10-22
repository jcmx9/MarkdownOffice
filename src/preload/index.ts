import { contextBridge, ipcRenderer } from 'electron'
import { Ch } from '../shared/ipc'
import type { ExternalChange, MdoApi, MenuCommand } from '../shared/types'

const api: MdoApi = {
  startup: () => ipcRenderer.invoke(Ch.startup),
  readNote: (path) => ipcRenderer.invoke(Ch.readNote, path),
  newNotePath: () => ipcRenderer.invoke(Ch.newNotePath),
  releasePath: (path) => ipcRenderer.invoke(Ch.releasePath, path),
  saveNote: (path, text, bom, base, force) =>
    ipcRenderer.invoke(Ch.saveNote, path, text, bom, base, force),
  renameNote: (from, newName) => ipcRenderer.invoke(Ch.renameNote, from, newName),
  showOpenDialog: () => ipcRenderer.invoke(Ch.openDialog),
  exportPdf: (path) => ipcRenderer.invoke(Ch.exportPdf, path),
  saveSession: (patch) => ipcRenderer.invoke(Ch.saveSession, patch),
  watch: (paths) => ipcRenderer.invoke(Ch.watch, paths),
  confirmDiscard: (names) => ipcRenderer.invoke(Ch.confirmDiscard, names),
  onMenu: (cb) => {
    ipcRenderer.on(Ch.menu, (_e, cmd: MenuCommand) => cb(cmd))
  },
  onSpellReplace: (cb) => {
    ipcRenderer.on(Ch.spellReplace, (_e, m) => cb(m))
  },
  onSpellRecheck: (cb) => {
    ipcRenderer.on(Ch.spellRecheck, () => cb())
  },
  setSpellLanguage: (lang) => ipcRenderer.invoke(Ch.spellLanguage, lang),
  downloadDictionary: (code) => ipcRenderer.invoke(Ch.spellDownload, code),
  checkDictionaryUpdates: () => ipcRenderer.invoke(Ch.spellCheckUpdates),
  declineDictionary: (code) => ipcRenderer.invoke(Ch.spellDecline, code),
  spellWords: () => ipcRenderer.invoke(Ch.spellWords),
  removeSpellWord: (word) => ipcRenderer.invoke(Ch.spellRemoveWord, word),
  onOpenPaths: (cb) => {
    ipcRenderer.on(Ch.openPaths, (_e, paths: string[]) => cb(paths))
  },
  onExternalChange: (cb) => {
    ipcRenderer.on(Ch.externalChange, (_e, change: ExternalChange) => cb(change))
  },
  setFullScreen: (on) => ipcRenderer.invoke(Ch.setFullScreen, on),
  listSnippets: () => ipcRenderer.invoke(Ch.listSnippets),
  listSets: () => ipcRenderer.invoke(Ch.listSets),
  readSetHeader: (name) => ipcRenderer.invoke(Ch.readSetHeader, name),
  listProfiles: (name) => ipcRenderer.invoke(Ch.listProfiles, name),
  createProfile: (set, name) => ipcRenderer.invoke(Ch.createProfile, set, name),
  validationInputs: (path, template, profile) =>
    ipcRenderer.invoke(Ch.validationInputs, path, template, profile),
  showNoteMenu: () => ipcRenderer.invoke(Ch.noteMenu),
  revealPath: (path) => ipcRenderer.invoke(Ch.revealPath, path),
  openTemplatesFolder: () => ipcRenderer.invoke(Ch.openTemplatesFolder),
  getSettingsStatus: () => ipcRenderer.invoke(Ch.settingsStatus),
  updateSettings: (patch) => ipcRenderer.invoke(Ch.updateSettings, patch),
  choosePath: (kind, current) => ipcRenderer.invoke(Ch.choosePath, kind, current),
  onFullScreenLeft: (cb) => {
    ipcRenderer.on(Ch.fullScreenLeft, () => cb())
  },
  onFullScreenRefused: (cb) => {
    ipcRenderer.on(Ch.fullScreenRefused, () => cb())
  },
  onBeforeClose: (cb) => {
    ipcRenderer.on(Ch.beforeClose, async () => {
      let ok = false
      try {
        ok = await cb()
      } catch (err) {
        console.error('beforeClose failed', err)
      } finally {
        ipcRenderer.send(Ch.closeReady, ok)
      }
    })
  },
}

contextBridge.exposeInMainWorld('mdo', api)
