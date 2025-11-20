'use client';

/**
 * Determine the base path the Next.js app is running under.
 * Falls back to the environment variable when executed during SSR.
 */
export function getBasePath(): string {
  if (typeof window !== 'undefined') {
    const nextData = (window as typeof window & { __NEXT_DATA__?: { config?: { basePath?: string }; assetPrefix?: string } })
      .__NEXT_DATA__;

    if (nextData?.config?.basePath) {
      return nextData.config.basePath;
    }

    if (nextData?.assetPrefix) {
      return nextData.assetPrefix;
    }

    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    return pathSegments.length > 0 ? `/${pathSegments[0]}` : '';
  }

  return process.env.NEXT_PUBLIC_BASE_PATH ?? '';
}

/**
 * Prefix an API route or relative path with the base path, if necessary.
 */
export function withBasePath(path: string): string {
  if (!path) {
    return getBasePath();
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const base = getBasePath();
  const normalizedTarget = path.startsWith('/') ? path : `/${path}`;

  if (!base || base === '/') {
    return normalizedTarget;
  }

  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${normalizedBase}${normalizedTarget}`;
}





