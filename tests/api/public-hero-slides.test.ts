import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/public/hero-slides/route';
import * as config from '@/lib/config';

vi.mock('@/lib/config', () => ({
  CONFIG_KEYS: { MOBILE_HERO_SLIDES: 'MOBILE_HERO_SLIDES' },
  getAllConfig: vi.fn(),
}));

describe('/api/public/hero-slides GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted slides from config', async () => {
    vi.mocked(config.getAllConfig).mockResolvedValue({
      MOBILE_HERO_SLIDES: JSON.stringify([
        { imageUrl: 'https://example.com/slide1.jpg', title: 'Slide 1', subtitle: 'Sub 1', actionLabel: 'Go', actionUrl: '/go' },
        { imageUrl: '/local/slide2.jpg', title: 'Slide 2', subtitle: null, actionLabel: null, actionUrl: null },
      ]),
    } as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.slides).toHaveLength(2);
    // Absolute URLs pass through unmodified
    expect(data.slides[0].imageUrl).toBe('https://example.com/slide1.jpg');
    // Local URLs get wrapped in the proxy path
    expect(data.slides[1].imageUrl).toBe('/api/public/hero-image?path=%2Flocal%2Fslide2.jpg');
    
    // Check cache headers
    expect(res.headers.get('Cache-Control')).toContain('public');
  });

  it('falls back to default slides when config is missing', async () => {
    vi.mocked(config.getAllConfig).mockResolvedValue({} as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.slides.length).toBeGreaterThan(0);
  });
});
