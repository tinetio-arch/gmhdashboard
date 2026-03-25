export function getBasePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH || '';
}

export function withBasePath(path: string): string {
  const basePath = getBasePath();

  // FIX(2026-03-24): Ensure API paths end with trailing slash to prevent
  // Next.js 308 redirects which drop POST/PATCH/DELETE bodies on iPad Safari.
  // Paths with query strings get the slash inserted before the '?'.
  let normalized = path;
  if (normalized.startsWith('/api/') || normalized.startsWith('api/')) {
    const qIndex = normalized.indexOf('?');
    if (qIndex === -1) {
      if (!normalized.endsWith('/')) normalized += '/';
    } else {
      const before = normalized.slice(0, qIndex);
      if (!before.endsWith('/')) normalized = before + '/' + normalized.slice(qIndex);
    }
  }

  if (!basePath) return normalized;
  if (normalized.startsWith(basePath)) return normalized;

  // Ensure path starts with / if basePath is not empty
  const cleanPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `${basePath}${cleanPath}`;
}
