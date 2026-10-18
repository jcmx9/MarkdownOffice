export function checkPackedResources(o: {
  resourcesDir: string
  platform: string
  fonts: string[]
  licenses: string[]
  /** .bdic file names; required on Windows/Linux only. */
  dictionaries?: string[]
}): void
export function manifestLicenses(manifest: {
  typst: { licenses: string[] }
  fonts: { license: { file: string } }[]
  packages: { name: string; license: string }[]
  dictionaries?: { file: string; license: { file: string } | { file: string }[] }[]
}): string[]
export default function afterPack(context: {
  appOutDir: string
  electronPlatformName: string
  packager: { appInfo: { productFilename: string } }
}): Promise<void>
