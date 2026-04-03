/**
 * fix-stray-commas.mjs
 * Fixes lines where insertKey injected ", key: value" before a closing },
 * creating "    , key: value}," which is a syntax error.
 * Corrects to:  "      key: value,\n    },"
 */
import { readFileSync, writeFileSync } from 'fs';

const LOCALES = ['fr', 'it', 'sw', 'tl', 'hi'];

for (const locale of LOCALES) {
  const file = `locales/${locale}.ts`;
  let content = readFileSync(file, 'utf8');
  const before = content;

  // Pattern: line starting with spaces, then ", key: value}," or ", key: value },"
  // Capture groups: (indent)(, key: value...)(},?)
  // Replace with: (indent+2)(key: value...),\n(indent)(},?)
  content = content.replace(
    /^(\s+), ([a-zA-Z]\w+: [^\n]+?)(},?)$/gm,
    (match, indent, keyVal, closing) => {
      return `${indent}  ${keyVal},\n${indent}${closing}`;
    }
  );

  // Also fix any remaining "  ,\n" stray comma lines that might still be there
  content = content.replace(/^\s*,\s*\n/gm, '');

  if (content !== before) {
    writeFileSync(file, content);
    const fixedLines = (before.match(/^(\s+), ([a-zA-Z])/gm) || []).length;
    console.log(`✓ ${locale}: fixed stray comma patterns`);
  } else {
    console.log(`  ${locale}: no changes needed`);
  }
}

console.log('Done.');
