import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LandingPage } from '@/components/landing/editorial/LandingPage';
import { FLOW_LENGTH, FLOW_PERIOD, FLOW_PULSE, ribbonFrame } from '@/components/landing/editorial/ribbon-geometry.js';

describe('editorial home integration', () => {
  it('server-renders without browser globals and stays compatible with the production CSP', () => {
    const html = renderToStaticMarkup(createElement(LandingPage));
    expect(html).toContain('Selesai dipakai.');
    expect(html).toContain('Coba simulasi setoran');
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toContain('waste-reloop.com');
    expect(html).toMatch(/href="\/register"[^>]*>Mulai perjalananmu/);
    expect(html).toMatch(/href="\/login"/);
    expect(html).toMatch(/href="\/privacy"/);
    expect(html).toMatch(/href="\/terms"/);
  });

  it('keeps a finite, fixed front/back silhouette and one ordered material route', () => {
    const shape = ribbonFrame();
    expect(shape).toEqual(ribbonFrame());
    for (const side of [shape.front, shape.rear]) {
      expect(side).toMatch(/^M/);
      expect(side).toMatch(/Z$/);
      expect(side).not.toMatch(/NaN|Infinity/);
      for (const value of side.match(/-?\d+(?:\.\d+)?/g) ?? []) {
        expect(Math.abs(Number(value))).toBeLessThan(1500);
      }
    }
    expect(shape.flow).toMatch(/^M-12 734/);
    expect(shape.flow).toMatch(/1093,230$/);
    expect(shape.flow.match(/M/g)).toHaveLength(1);
  });

  it('tiles the material pattern exactly for a seamless forward loop', () => {
    expect(FLOW_LENGTH % FLOW_PERIOD).toBe(0);
    expect(FLOW_PULSE).toBeGreaterThan(0);
    expect(FLOW_PULSE).toBeLessThan(FLOW_PERIOD);
  });
});
