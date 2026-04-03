/**
 * fix-errors-section.mjs
 * Removes floating validation keys and the stray `,` line from errors: section
 * in fr/it/sw/tl/hi locale files.
 */
import { readFileSync, writeFileSync } from 'fs';

const FILES = ['fr', 'it', 'sw', 'tl', 'hi'].map(l => [`locales/${l}.ts`, l]);

for (const [file, locale] of FILES) {
  let content = readFileSync(file, 'utf8');
  const lines = content.split('\n');

  let inErrors = false;
  let errorsDepth = 0;
  let inValidation = false;
  const filteredLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track when we enter errors: section
    if (/^\s{2}errors\s*:\s*\{/.test(line)) {
      inErrors = true;
      errorsDepth = 1;
      filteredLines.push(line);
      continue;
    }

    if (inErrors) {
      // Track depth
      for (const ch of line) {
        if (ch === '{') errorsDepth++;
        else if (ch === '}') errorsDepth--;
      }

      if (errorsDepth === 0) {
        inErrors = false;
        inValidation = false;
        filteredLines.push(line);
        continue;
      }

      // Detect entering validation sub-object
      if (/^\s{4}validation\s*:\s*\{/.test(line)) {
        inValidation = true;
        filteredLines.push(line);
        continue;
      }

      if (inValidation) {
        filteredLines.push(line);
        continue;
      }

      // Skip floating validation keys (6-space indent, ALL_CAPS keys)
      if (/^\s{6}[A-Z_]+\s*:/.test(line)) {
        // This is a floating validation key — skip it
        continue;
      }

      // Skip the stray `,` line
      if (/^\s{2},\s*$/.test(line)) {
        continue;
      }

      filteredLines.push(line);
    } else {
      filteredLines.push(line);
    }
  }

  const result = filteredLines.join('\n');
  writeFileSync(file, result);

  const removed = lines.length - filteredLines.length;
  console.log(`✓ ${locale}: removed ${removed} lines`);
}

console.log('Done.');
