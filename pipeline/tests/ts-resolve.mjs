// Lets Node's type stripping run the app's TypeScript as written (pipeline/tests/math-core.mts):
// src/ imports its own modules without an extension (bundler resolution), Node's ESM resolver
// wants the file name. A relative import that is not found is retried with `.ts`; nothing
// else changes. Loaded with `node --import`; in-thread hooks where Node has them (22.15+),
// otherwise the hooks thread of module.register (the floor 22.12 has that).
import * as nodeModule from 'node:module'
import { isMainThread } from 'node:worker_threads'

const RELATIVE_WITHOUT_EXT = /^\.\.?\/(?:.*\/)?[^./]+$/

const notFound = (err) => err?.code === 'ERR_MODULE_NOT_FOUND'

export function resolveSync(specifier, context, next) {
  try {
    return next(specifier, context)
  } catch (err) {
    if (notFound(err) && RELATIVE_WITHOUT_EXT.test(specifier))
      return next(`${specifier}.ts`, context)
    throw err
  }
}

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (err) {
    if (notFound(err) && RELATIVE_WITHOUT_EXT.test(specifier))
      return next(`${specifier}.ts`, context)
    throw err
  }
}

if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ resolve: resolveSync })
} else if (isMainThread) {
  // The hooks thread loads this file again; only the main thread registers.
  nodeModule.register(import.meta.url)
}
