function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactLog(message: string, authorizedRoots: readonly string[]): string {
  const protectedRoots = new Map<string, string>();
  let result = message;
  authorizedRoots.forEach((root, index) => {
    const marker = `__CBM_AUTHORIZED_ROOT_${index}__`;
    protectedRoots.set(marker, root);
    result = result.replace(new RegExp(escapeRegex(root), 'gi'), marker);
  });
  result = result
    .replace(/(Authorization:\s*Bearer\s+)\S+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk|sk-proj)-[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\b[A-Za-z]:[\\/][^\s]+/g, '[PATH]')
    .replace(/(?:^|\s)\/(?:[^\s/]+\/)+[^\s]*/g, ' [PATH]');
  for (const [marker, root] of protectedRoots) result = result.replaceAll(marker, root);
  return result;
}
