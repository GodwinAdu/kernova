/**
 * CLI UI utilities
 */

const VERSION = '0.1.0';

export function printBanner(): void {
  console.log(`
  ╔══════════════════════════════════════╗
  ║                                      ║
  ║   ◆  N E X U S                       ║
  ║      Intelligent Systems Runtime     ║
  ║      v${VERSION}                          ║
  ║                                      ║
  ╚══════════════════════════════════════╝
  `);
}

export function printVersion(): void {
  console.log(`nexus v${VERSION}`);
}

export function printHelp(): void {
  console.log(`
  Usage: nexus <command> [options]

  Commands:
    init [name]       Create a new Nexus project
    dev               Start the development runtime
    deploy [target]   Prepare for production (docker, node)
    agent <action>    Manage agents (create, list, inspect)
    status            Show runtime status
    
  Options:
    -h, --help        Show this help message
    -v, --version     Show version number

  Examples:
    nexus init my-app
    nexus dev
    nexus agent create assistant
    nexus status

  Documentation: https://nexus.dev/docs
  `);
}

export function success(message: string): void {
  console.log(`  ✓ ${message}`);
}

export function info(message: string): void {
  console.log(`  → ${message}`);
}

export function warn(message: string): void {
  console.log(`  ⚠ ${message}`);
}

export function error(message: string): void {
  console.error(`  ✗ ${message}`);
}
