import type { MetadataRoute } from 'next';

/** Private instance: ask every crawler to stay out, share links included (G7). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
