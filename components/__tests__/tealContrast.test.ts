// QA U7: teal #0D9488 text on white / #F8FAFC is 3.74:1 / 3.57:1, below the
// 4.5:1 WCAG AA minimum. Teal text and icons use the text-safe token instead.
import fs from 'fs';
import path from 'path';

import { brand, Colors } from '@/constants/Colors';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const ROOT = path.resolve(__dirname, '..', '..');
const DIRS = ['app', 'components', 'styles'];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...sources(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('teal text contrast', () => {
  it('the fill teal is below AA as text, which is why it is not used for text', () => {
    expect(contrast(brand.primary, '#FFFFFF')).toBeLessThan(4.5);
  });

  it.each(['#FFFFFF', Colors.light.background])('text-safe teal passes AA on %s', (bg) => {
    expect(contrast(Colors.light.tintText, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(brand.primaryDark, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('dark-mode text teal passes AA on dark surfaces', () => {
    expect(contrast(Colors.dark.tintText, Colors.dark.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('no style uses the fill teal as a text colour', () => {
    const pattern = /\bcolor: (brand\.primary|colors\.tint|theme\.tint|Colors\.light\.tint|'#0D9488')\b(?!Text|Dark|Deep|Light|Surface)/i;
    const offenders = DIRS.flatMap((dir) => sources(path.join(ROOT, dir)))
      .flatMap((file) =>
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, at: `${path.relative(ROOT, file)}:${i + 1}` })),
      )
      .filter(({ line }) => pattern.test(line))
      .map(({ at, line }) => `${at} ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
