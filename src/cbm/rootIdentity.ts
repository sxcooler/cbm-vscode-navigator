export function rootIdentity(path: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}
