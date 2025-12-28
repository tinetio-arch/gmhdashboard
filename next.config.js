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
  },
  // Exclude backup directories from build
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/backups/**', '**/backups.excluded/**', '**/node_modules/**'],
    };
    return config;
  },
};

module.exports = nextConfig;





