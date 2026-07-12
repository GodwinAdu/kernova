/**
 * kernova login
 *
 * Authenticates with Kernova Cloud by opening the browser
 * for API key creation, or accepting a key directly.
 *
 * Usage:
 *   kernova login                  # Opens browser to create key
 *   kernova login --key kn_live_xxxxx   # Use existing key
 *   kernova logout                 # Remove saved credentials
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { printBanner, success, info, error } from '../ui.js';

const CREDENTIALS_DIR = join(homedir(), '.kernova');
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, 'credentials.json');
const CLOUD_URL = process.env.KERNOVA_CLOUD_URL || 'https://cloud.kernova.app';

interface Credentials {
  apiKey: string;
  cloudUrl: string;
  createdAt: string;
}

export async function handleLogin(args: string[]): Promise<void> {
  printBanner();

  // Check for --key flag (direct key input)
  const keyIdx = args.indexOf('--key');
  if (keyIdx !== -1 && args[keyIdx + 1]) {
    const key = args[keyIdx + 1];

    if (!key.startsWith('kn_live_') && !key.startsWith('kn_test_')) {
      error('Invalid API key format. Keys start with "kn_live_" or "kn_test_".');
      process.exit(1);
    }

    saveCredentials({ apiKey: key, cloudUrl: CLOUD_URL, createdAt: new Date().toISOString() });
    success('Logged in to Kernova Cloud');
    console.log(`    Key: ${key.slice(0, 16)}...`);
    console.log(`    Cloud: ${CLOUD_URL}`);
    console.log('');
    return;
  }

  // Interactive: open browser
  info('To deploy to Kernova Cloud, you need an API key.');
  console.log('');
  console.log(`  1. Open: ${CLOUD_URL}/dashboard/settings`);
  console.log('  2. Create a new API key');
  console.log('  3. Run: kernova login --key YOUR_KEY');
  console.log('');

  // Try to open browser
  try {
    const { exec } = await import('node:child_process');
    const url = `${CLOUD_URL}/dashboard/settings`;

    if (process.platform === 'win32') {
      exec(`start ${url}`);
    } else if (process.platform === 'darwin') {
      exec(`open ${url}`);
    } else {
      exec(`xdg-open ${url}`);
    }
    info('Browser opened. Create an API key and paste it below.');
  } catch {
    // Browser open failed — just show instructions
  }

  // Wait for user to paste key (simple stdin read)
  console.log('');
  process.stdout.write('  Paste your API key: ');

  const key = await readLine();

  if (!key || (!key.startsWith('kn_live_') && !key.startsWith('kn_test_'))) {
    error('Invalid API key. Run "kernova login --key YOUR_KEY" with a valid key.');
    process.exit(1);
  }

  saveCredentials({ apiKey: key.trim(), cloudUrl: CLOUD_URL, createdAt: new Date().toISOString() });
  console.log('');
  success('Logged in to Kernova Cloud');
  console.log('');
  info('You can now run "kernova deploy" to deploy your project.');
  console.log('');
}

export async function handleLogout(_args: string[]): Promise<void> {
  printBanner();

  if (existsSync(CREDENTIALS_FILE)) {
    unlinkSync(CREDENTIALS_FILE);
    success('Logged out. Credentials removed.');
  } else {
    info('Not logged in.');
  }
}

/**
 * Get saved credentials (used by deploy command).
 */
export function getCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;

  try {
    const raw = readFileSync(CREDENTIALS_FILE, 'utf-8');
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

function saveCredentials(credentials: Credentials): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.resume();
    process.stdin.on('data', (chunk) => {
      data += chunk;
      if (data.includes('\n')) {
        process.stdin.pause();
        resolve(data.trim());
      }
    });
  });
}
