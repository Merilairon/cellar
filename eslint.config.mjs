import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Edge-safe files: keep DB and native modules out of the proxy bundle.
    files: [
      'src/proxy.ts',
      'src/lib/security/headers.ts',
      'src/lib/auth/routes.ts',
      'src/lib/auth/cookie-name.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'better-sqlite3',
            'argon2',
            'node:*',
            '@/lib/db',
            '@/lib/db/*',
            '@/lib/auth/password',
            '@/lib/auth/session',
            '@/lib/auth/cookies',
            '@/lib/auth/current-user',
          ],
        },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'next-env.d.ts',
    'node_modules/**',
    'drizzle/**',
    'dist/**',
    '.claude/**',
    '.kilo/**',
    '.vibe/**',
  ]),
]);
