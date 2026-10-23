// Not named linebreak.d.ts: next to linebreak.ts TypeScript would take it as that file's types.
// linebreak 1.1.0 ships no types; only the part breaks.ts uses is declared.
declare module 'linebreak' {
  interface Break {
    /** UTF-16 offset where the next line would start. */
    position: number
    /** A mandatory break (after BK, CR, LF, NL). */
    required: boolean
  }
  export default class LineBreaker {
    constructor(text: string)
    nextBreak(): Break | null
  }
}
