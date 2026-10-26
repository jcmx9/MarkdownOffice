/**
 * Label of „show the note in the file manager“, shared by the menus (main) and the status-line
 * hover text (renderer), so both name the same entry. Users know the file manager by its own
 * name (Finder, Explorer); Linux desktops differ, so a generic name there.
 */
export function revealLabel(platform: string): string {
  if (platform === 'darwin') return 'Im Finder zeigen'
  if (platform === 'win32') return 'Im Explorer zeigen'
  return 'Im Dateimanager zeigen'
}

/**
 * Shortcut of the same entry, as other editors have it (VS Code: ⌥⌘R, Shift+Alt+R). Not
 * Ctrl+Alt+R on Windows/Linux: on German and other layouts Ctrl+Alt is AltGr.
 */
export function revealAccelerator(platform: string): string {
  return platform === 'darwin' ? 'Alt+Cmd+R' : 'Shift+Alt+R'
}

/**
 * The sandboxed renderer has no `process.platform`; its user agent names the OS ("Macintosh",
 * "Windows NT", else Linux and others). Returns the matching `process.platform` value.
 */
export function platformFromUserAgent(userAgent: string): string {
  if (userAgent.includes('Mac')) return 'darwin'
  if (userAgent.includes('Windows')) return 'win32'
  return 'linux'
}
