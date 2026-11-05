import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  // Native modules are added in T2; listed now so they are never bundled.
  serverExternalPackages: ['better-sqlite3', 'argon2'],
};

export default withNextIntl(nextConfig);
