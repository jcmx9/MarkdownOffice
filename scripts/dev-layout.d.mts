export function bashFor(
  platform: string,
  env: Record<string, string | undefined>,
  exists: (p: string) => boolean,
): string
