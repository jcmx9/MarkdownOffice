/**
 * The text of an error thrown by a main-process handler, without the prefix Electron adds on
 * the way (`Error invoking remote method '<channel>': Error: `), so the user reads only main's
 * own sentence.
 */
export function remoteMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '')
}
