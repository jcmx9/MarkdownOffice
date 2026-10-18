export type Manifest = {
  typst: {
    version: string
    /** Licence files next to the binary in the release archive (LICENSE, NOTICE). */
    licenses: string[]
    targets: Record<string, { url: string; sha256: string; bin: string }>
  }
  fonts: {
    url: string
    sha256: string
    extract?: string[]
    file?: string
    /** `extract`: path (suffix) inside the font archive; else a pinned `url` + `sha256`. */
    license: { file: string; extract?: string; url?: string; sha256?: string }
  }[]
  /** `store`: unpacked to vendor/packages/preview/<name>/<version> (Typst package-cache layout). */
  packages: { name: string; version: string; sha256: string; license: string; store?: boolean }[]
  sets: { name: string; repo: string; tag: string; sha256: string }[]
  /** Hunspell dictionaries for Windows/Linux; `file` is the canonical Chromium name. */
  dictionaries?: {
    code: string
    file: string
    url: string
    sha256: string
    /**
     * One licence file or several. `encoding: 'base64'`: served base64-encoded; `sha256` pins
     * the decoded text.
     */
    license: DictLicense | DictLicense[]
  }[]
}
export type DictLicense = { file: string; url: string; sha256: string; encoding?: 'base64' }
export function dictLicenses(dict: NonNullable<Manifest['dictionaries']>[number]): DictLicense[]
export function folderName(target: string): string
export function hostTarget(): string
export function fetchAssets(o: {
  manifest: Manifest
  target: string | string[]
  outDir: string
  download?: (url: string) => Promise<Uint8Array>
  log?: (message: string) => void
  env?: Record<string, string | undefined>
}): Promise<void>
