import type { Finding, FindingCode } from './frontmatter-validate'

/**
 * German message of a finding. One entry per `FindingCode` (params: see that type), keyed by
 * the code so Phase 1b can swap the table for a translation without touching the validator.
 * The messages name the key and the value as written; the suggestion is shown by the dialog.
 */
const MESSAGES: Record<FindingCode, (f: Finding) => string> = {
  'validate.syntax': (f) =>
    `Zeile ${f.line}: Diese Zeile ist kein gültiges YAML${f.params.reason ? ` (${f.params.reason})` : ''}.`,
  'validate.duplicate': (f) =>
    `„${f.key}“ steht mehrfach im Kopf (zuerst in Zeile ${f.params.first ?? '?'}); die Pipeline nimmt die letzte.`,
  'validate.bool': (f) => `„${f.key}“ erwartet true oder false, gefunden: ${f.params.value ?? ''}.`,
  'validate.enum': (f) =>
    `„${f.key}“: „${f.params.value ?? ''}“ ist nicht erlaubt (erlaubt: ${f.params.allowed ?? ''}).`,
  'validate.date.invalid': (f) =>
    `„${f.key}“: „${f.params.value ?? ''}“ ist kein Datum im Format JJJJ-MM-TT oder T.M.JJJJ.`,
  'validate.date.impossible': (f) =>
    `„${f.key}“: „${f.params.value ?? ''}“ gibt es im Kalender nicht.`,
  'validate.length': (f) =>
    `„${f.key}“: „${f.params.value ?? ''}“ ist nicht als Länge geschrieben; erwartet wird eine Zahl mit Einheit ohne Leerzeichen (mm, cm, pt, in), etwa 15mm.`,
  'validate.length.max': (f) =>
    `„${f.key}“: ${f.params.value ?? ''} ist größer als der Höchstwert ${f.params.max ?? ''}.`,
  'validate.length.min': (f) =>
    `„${f.key}“: ${f.params.value ?? ''} ist kleiner als der Mindestwert ${f.params.min ?? ''}.`,
  'validate.list': (f) =>
    `„${f.key}“ erwartet eine Liste, gefunden: ${f.params.value ?? ''}. In eckigen Klammern wird daraus eine Liste.`,
  'validate.lines.max': (f) =>
    `„${f.key}“ hat ${f.params.count ?? '?'} Zeilen, erlaubt sind höchstens ${f.params.max ?? '?'}.`,
  'validate.text.quote': (f) =>
    `„${f.key}“: ${f.params.value ?? ''} liest YAML als ${textKind(f.params.as)}, nicht als Text; in Anführungszeichen bleibt es Text.`,
  'validate.file.ext': (f) =>
    `„${f.key}“: „${f.params.value ?? ''}“ hat keine passende Endung (erlaubt: ${f.params.allowed ?? ''}).`,
  'validate.name': (f) =>
    `„${f.key}“: „${f.params.value ?? ''}“ ist kein gültiger Name; erlaubt sind a–z, 0–9, „-“ und „_“.`,
  'validate.lang': (f) =>
    `„${f.key}“: „${f.params.value ?? ''}“ ist kein Sprachcode; erwartet wird etwa de oder en-GB.`,
  'validate.template.unknown': (f) =>
    `„template“: Die Vorlage „${f.params.value ?? ''}“ ist nicht installiert.`,
  'validate.profile.missing': (f) =>
    `„profile“: Das Profil „${f.params.value ?? ''}“ wurde nicht gefunden${f.params.searched ? ` (gesucht in: ${f.params.searched.split('\n').join(', ')})` : ''}.`,
  'validate.profile.invalid': (f) =>
    `„profile“: „${f.params.value ?? ''}“ ist kein gültiger Profilname.`,
  'validate.key.typo': (f) =>
    `Unbekannter Schlüssel „${f.key}“${f.params.similar ? `; gemeint ist vielleicht „${f.params.similar}“` : ''}.`,
}

function textKind(as: string | undefined): string {
  if (as === 'bool') return 'Wahrheitswert'
  if (as === 'null') return 'leeren Wert'
  return 'Zahl'
}

export function findingMessage(f: Finding): string {
  return MESSAGES[f.code](f)
}
