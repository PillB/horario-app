/**
 * phases-salvage.mjs
 *
 * Run this after phases-batch.mjs completes to re-process results
 * without re-submitting the batch (uses cached phases-results.json).
 *
 * Usage:
 *   node scripts/phases-salvage.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  const abs = path.join(ROOT, relPath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

function write(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  console.log(`  ✓ wrote ${relPath}`);
}

function stripFences(text) {
  return text
    .replace(/^```(?:typescript|tsx|ts|jsx|js|sql|json|markdown|md)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

function parseMultiFile(text) {
  const files = [];
  const pattern = /---\s*FILE:\s*([^\n]+)\s*---\n([\s\S]*?)---\s*END FILE\s*---/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    files.push({ path: match[1].trim(), content: match[2].trim() });
  }
  return files;
}

const singleFilePaths = {
  'phase-1-calendar-component': 'components/scheduler/WeekCalendar.tsx',
  'phase-1-roster-section': 'components/scheduler/RosterSection.tsx',
  'phase-4a-demand-forecast-engine': 'services/forecastEngine.ts',
  'phase-4b-pos-upload-ui': 'components/scheduler/PosUploadSection.tsx',
  'phase-4c-proxy-pos-actions': 'app/api/secure-proxy+api.ts',
  'phase-6-locale-additions': 'locales/en.ts',
};

const resultsPath = path.join(ROOT, 'scripts/phases-results.json');
if (!fs.existsSync(resultsPath)) {
  console.error('scripts/phases-results.json not found. Run phases-batch.mjs first.');
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
let filesWritten = 0;

for (const [id, result] of Object.entries(results)) {
  if (!result.ok) {
    console.error(`  ✗ ${id} failed:`, result.error);
    continue;
  }
  const text = result.text;
  const multiFiles = parseMultiFile(text);

  if (multiFiles.length > 0) {
    console.log(`\n[${id}] Writing ${multiFiles.length} file(s):`);
    for (const { path: filePath, content } of multiFiles) {
      write(filePath, stripFences(content));
      filesWritten++;
    }
  } else if (singleFilePaths[id]) {
    console.log(`\n[${id}] Writing single file:`);
    write(singleFilePaths[id], stripFences(text));
    filesWritten++;
  } else {
    console.log(`\n[${id}] No output path — inspect scripts/phases-results.json`);
    // Print first 200 chars as preview
    console.log(`  Preview: ${text.slice(0, 200)}...`);
  }
}

console.log(`\n✅ Wrote ${filesWritten} file(s). Now run: npm test && npm run lint`);
