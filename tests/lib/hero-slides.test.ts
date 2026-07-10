import { describe, expect, it } from 'vitest';
import { parseHeroSlides } from '@/lib/hero-slides';

const fallback = [
  {
    eyebrow: 'Default',
    title: 'Fallback',
    description: 'Desc',
    imageUrl: '/hero-ai-community.webp',
    href: '/register',
  },
];

describe('parseHeroSlides', () => {
  it('returns fallback for empty or invalid JSON', () => {
    expect(parseHeroSlides(null as any, fallback)).toBe(fallback);
    expect(parseHeroSlides('', fallback)).toBe(fallback);
    expect(parseHeroSlides('{bad', fallback)).toBe(fallback);
    expect(parseHeroSlides('{}', fallback)).toBe(fallback);
  });

  it('filters invalid slides and keeps safe ones', () => {
    const raw = JSON.stringify([
      null,
      'x',
      { title: '', imageUrl: '/ok.webp', href: '/register' },
      { title: 'Ok', imageUrl: 'javascript:alert(1)', href: '/register' },
      {
        eyebrow: 'Hi',
        title: 'Valid',
        description: 'D',
        imageUrl: '/hero.webp',
        href: '/login',
      },
    ]);
    const slides = parseHeroSlides(raw, fallback);
    expect(slides).toHaveLength(1);
    expect(slides[0].title).toBe('Valid');
    expect(slides[0].imageUrl).toBe('/hero.webp');
  });

  it('applies default imageUrl/href and returns fallback when all filtered', () => {
    const raw = JSON.stringify([
      { title: 'Only title' },
      { title: 'Bad', imageUrl: 'ftp://x', href: '/x' },
    ]);
    const slides = parseHeroSlides(raw, fallback);
    expect(slides[0].imageUrl).toBe('/hero-ai-community.webp');
    expect(slides[0].href).toBe('/register');

    expect(
      parseHeroSlides(JSON.stringify([{ title: 'Nope', imageUrl: 'bad://x', href: 'bad://y' }]), fallback),
    ).toBe(fallback);
  });

  it('coerces null title/description/eyebrow via empty-string fallbacks then filters', () => {
    const slides = parseHeroSlides(
      JSON.stringify([
        {
          eyebrow: null,
          title: null,
          description: null,
          imageUrl: '/hero.webp',
          href: '/login',
        },
      ]),
      fallback,
    );
    expect(slides).toBe(fallback);
  });
});
