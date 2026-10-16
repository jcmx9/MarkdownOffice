import { join } from 'node:path'

/**
 * The userData folder to set before the single-instance lock, or null to keep Electron's
 * default. Development gets its own folder so `npm run dev` never shares settings, session or
 * the lock with an installed Markdown Office; MDO_USER_DATA (tests) always wins.
 */
export function userDataOverride(
  env: Record<string, string | undefined>,
  isPackaged: boolean,
  appData: string,
): string | null {
  if (env.MDO_USER_DATA) return env.MDO_USER_DATA
  return isPackaged ? null : join(appData, 'Markdown Office Dev')
}
