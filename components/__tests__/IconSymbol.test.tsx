// QA U1/U2: on Android and web an SF Symbol without a Material mapping drew
// nothing (the Profile tab icon). IconSymbolName now only admits mapped names,
// so tsc rejects an unmapped one; this checks the mapped glyphs exist.
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

// Explicit file: the jest-expo preset would otherwise resolve IconSymbol.ios.tsx.
import { MAPPING } from '../ui/IconSymbol.tsx';

describe('IconSymbol mapping', () => {
  it.each(Object.entries(MAPPING))('%s maps to the Material glyph %s', (_sf, material) => {
    expect(Object.prototype.hasOwnProperty.call(MaterialIcons.glyphMap, material)).toBe(true);
  });

  it('covers every icon the tab bar and header use', () => {
    for (const name of [
      'house.fill',
      'calendar',
      'chart.bar.fill',
      'person.crop.circle.fill',
      'wrench.and.screwdriver.fill',
      'rectangle.portrait.and.arrow.right',
    ]) {
      expect(MAPPING).toHaveProperty([name]);
    }
  });
});
