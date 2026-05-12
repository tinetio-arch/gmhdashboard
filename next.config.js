/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    optimizePackageImports: [
      '@tanstack/react-table',
    ],
    serverComponentsExternalPackages: ['pdfkit'],
  },
  // Exclude backup directories from build
  typescript: {
    // TODO: flip to false once the ~38 pre-existing type errors in app/
    // are cleaned up — Phil's directive, deferred from 2026-05-12 session
    // because doing it inline blocked the critical bug deploy.
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/backups/**', '**/backups.excluded/**', '**/node_modules/**'],
    };
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/ops/api/:path*',
        destination: '/api/:path*',
      },
      {
        source: '/ops/admin/:path*',
        destination: '/admin/:path*',
      },
    ];
  },
};

module.exports = nextConfig;





