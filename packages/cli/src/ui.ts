/**
 * CLI UI utilities
 */

const VERSION = '0.1.0';

export function printBanner(): void {
  console.log(`
  ╔══════════════════════════════════════╗
  ║                                      ║
  ║   ◆  K E R N O V A                  ║
  ║      Intelligent Systems Runtime     ║
  ║      v${VERSION}                     ║
  ║                                      ║
  ╚══════════════════════════════════════╝
  `);
}

export function printVersion(): void {
  console.log(`kernova v${VERSION}`);
}

export function printHelp(): void {
  console.log(`
  Usage: kernova <command> [options]

  Commands:
    init [name]       Create a new kernova project
    dev               Start the development runtime
    serve             Start the daemon in persistent mode
    deploy [target]   Prepare for production (docker, node)
    agent <action>    Manage agents (create, list, inspect)
    schedule <action> Manage scheduled jobs (list, enable, disable)
    queue <action>    Manage task queue (status, replay)
    triggers <action> Manage proactive triggers (list)
    status            Show runtime status
    
  Options:
    -h, --help        Show this help message
    -v, --version     Show version number

  Examples:
    kernova init my-app
    kernova dev
    kernova serve --config ./agents/ --watch
    kernova agent create assistant
    kernova schedule list
    kernova queue status
    kernova triggers list
    kernova status

  Documentation: https://kernova.dev/docs
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
