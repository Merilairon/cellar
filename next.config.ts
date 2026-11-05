import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  // Native modules are added in T2; listed now so they are never bundled.
  serverExternalPackages: ['better-sqlite3', 'argon2', 'sharp'],
  // Behind a reverse proxy the server-action Origin check must accept the public host.
  ...(process.env.BASE_URL
    ? { experimental: { serverActions: { allowedOrigins: [new URL(process.env.BASE_URL).host] } } }
    : {}),
};

export default withNextIntl(nextConfig);
