import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://helix.ai';

export default function sitemap(): MetadataRoute.Sitemap {
  const marketing = [
    '/',
    '/product',
    '/product/knowledge',
    '/product/skills',
    '/product/governance',
    '/product/memory',
    '/product/loop',
    '/product/integrations',
    '/use-cases',
    '/use-cases/consulting',
    '/use-cases/support',
    '/use-cases/sales',
    '/use-cases/finance',
    '/industries',
    '/industries/professional-services',
    '/industries/saas',
    '/industries/financial-services',
    '/industries/manufacturing',
    '/security',
    '/security/data-hosting',
    '/security/access-isolation',
    '/security/audit-compliance',
    '/pilot',
    '/pilot/request',
    '/imprint',
    '/privacy',
    '/dpa',
  ];

  return marketing.map((path) => ({
    url: `${BASE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : path.split('/').length <= 2 ? 0.8 : 0.6,
  }));
}
