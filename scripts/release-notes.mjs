// Prints the CHANGELOG.md section for a version ("2.1.0" or "v2.1.0"), used as GitHub release notes.
// Fails when the section is missing, so a release can't go out without notes.
import { readFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!version) {
  console.error('Usage: node scripts/release-notes.mjs <version>');
  process.exit(1);
}

const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
const start = lines.findIndex(line => line.startsWith(`## [${version}]`));
if (start < 0) {
  console.error(`CHANGELOG.md has no "## [${version}]" section. Add the release notes there first.`);
  process.exit(1);
}
const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
const notes = lines.slice(start + 1, next < 0 ? undefined : next).join('\n').trim();

console.log(notes);
console.log('\n---\n\nFull changelog: https://github.com/GodwinAdu/kernova/blob/main/CHANGELOG.md');
