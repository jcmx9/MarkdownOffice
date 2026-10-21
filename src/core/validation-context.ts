import { combineSchemas, PIPELINE_SCHEMA, parseSchema } from './frontmatter-schema'
import type { ProfileLookup, ValidationContext } from './frontmatter-validate'

/** What Node (main process or CLI) read from disk for one note; the core never touches files. */
export interface ValidationInputs {
  /** The set the note uses ('' for a `.typ` path: then header and schemaText are null). */
  set: string
  /** Names of every installed set. */
  sets: string[]
  /** The set's header file text (source of the missing keys). */
  header: string | null
  /** The set's `<name>.schema.yaml`, unparsed. */
  schemaText: string | null
  profile: ProfileLookup | null
}

/**
 * Builds the validator's context. A broken set schema must not take validation down: the
 * pipeline layer alone is used and the parse error is returned for a neutral notice.
 */
export function validationContext(inputs: ValidationInputs): {
  ctx: ValidationContext
  schemaError: string | null
} {
  let schema = PIPELINE_SCHEMA
  let schemaError: string | null = null
  if (inputs.schemaText !== null) {
    const loaded = parseSchema(inputs.schemaText)
    if (loaded.ok) schema = combineSchemas(PIPELINE_SCHEMA, loaded.schema)
    else schemaError = loaded.error
  }
  return {
    ctx: { schema, sets: inputs.sets, header: inputs.header, profile: inputs.profile },
    schemaError,
  }
}
