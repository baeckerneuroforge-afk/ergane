import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://helix.ai';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/dashboard/', '/api/', '/sign-in/', '/sign-up/', '/select-org/'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
