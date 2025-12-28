export function getBasePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH || '';
}

export function withBasePath(path: string): string {
  const basePath = getBasePath();
  if (!basePath) return path;
  if (path.startsWith(basePath)) return path;

  // Ensure path starts with / if basePath is not empty
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${basePath}${cleanPath}`;
}
