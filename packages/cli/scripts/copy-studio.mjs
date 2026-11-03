/**
 * Copies the static Studio export (packages/studio/out) into this package as
 * `studio/`, so `kernova studio` can serve the full dashboard after install.
 * If Studio hasn't been built, `kernova studio` falls back to its embedded page.
 */

import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../studio/out/', import.meta.url));
const target = fileURLToPath(new URL('../studio/', import.meta.url));

rmSync(target, { recursive: true, force: true });

if (existsSync(source)) {
  cpSync(source, target, { recursive: true });
  console.log('Bundled Kernova Studio into packages/cli/studio');
} else {
  console.log('Studio export not found (packages/studio/out); kernova studio will use the embedded dashboard');
}
