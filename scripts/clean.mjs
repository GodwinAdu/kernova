// Deletes the given paths, relative to the current directory (used by the packages' build and clean scripts)
import { rmSync } from 'node:fs';

for (const path of process.argv.slice(2)) rmSync(path, { recursive: true, force: true });
