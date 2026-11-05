// Publishes every Kernova package whose version isn't on npm yet, in dependency order.
// Run by .github/workflows/release.yml (npm trusted publishing: no token, provenance included).
// Locally, `node scripts/publish.mjs --dry-run` shows what a release would publish.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const ORDER = ['types', 'core', 'sdk', 'framework', 'cli', 'create-kernova-app', 'kernova'];
const dryRun = process.argv.includes('--dry-run');
const inActions = process.env.GITHUB_ACTIONS === 'true';
const onWindows = process.platform === 'win32';

// On Windows npm is a .cmd script, which needs a shell; the arguments are fixed, so one command string is safe
const npm = (args, options = {}) =>
  onWindows
    ? spawnSync(`npm ${args.join(' ')}`, { encoding: 'utf8', shell: true, ...options })
    : spawnSync('npm', args, { encoding: 'utf8', ...options });

const isOnNpm = (name, version) => {
  const res = npm(['view', `${name}@${version}`, 'version']);
  return res.status === 0 && res.stdout.trim() === version;
};

const packages = ORDER.map(dir => {
  const { name, version, private: isPrivate } = JSON.parse(readFileSync(`packages/${dir}/package.json`, 'utf8'));
  return { dir, name, version, isPrivate };
}).filter(p => !p.isPrivate);

const pending = [];
for (const p of packages) {
  const onNpm = isOnNpm(p.name, p.version);
  console.log(`${onNpm ? '  on npm   ' : '→ publish  '} ${p.name}@${p.version}`);
  if (!onNpm) pending.push(p);
}

if (pending.length === 0) {
  console.log('\nNothing to publish: every package version is already on npm.');
  process.exit(0);
}

// The CLI bundles Studio's static export at build time; without it, `kernova studio` loses the dashboard
if (pending.some(p => p.dir === 'cli') && !existsSync('packages/studio/out/index.html')) {
  console.error('\npackages/studio/out is missing, so the CLI would ship without Studio. Run `npm run build` first.');
  process.exit(1);
}

for (const p of pending) {
  console.log(`\n${dryRun ? 'Dry run' : 'Publishing'}: ${p.name}@${p.version}`);
  const args = ['publish', `--workspace=packages/${p.dir}`, '--access', 'public'];
  if (dryRun) args.push('--dry-run');
  else if (inActions) args.push('--provenance');

  const res = npm(args, { stdio: ['inherit', 'pipe', 'pipe'] });
  process.stdout.write(res.stdout ?? '');
  process.stderr.write(res.stderr ?? '');
  if (res.status !== 0) {
    // npm can take a few minutes before a new version shows in `npm view`; a re-run then hits this
    if (/previously published|cannot publish over/i.test(`${res.stdout}${res.stderr}`)) {
      console.log(`${p.name}@${p.version} is already published; continuing.`);
      continue;
    }
    console.error(`\nPublishing ${p.name}@${p.version} failed. Packages after it were not published.`);
    process.exit(1);
  }
}

console.log(`\n${dryRun ? 'Dry run finished' : 'Published'}: ${pending.map(p => `${p.name}@${p.version}`).join(', ')}`);
