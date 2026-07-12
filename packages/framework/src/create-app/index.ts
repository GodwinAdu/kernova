/**
 * create-app — Scaffolds a new full-stack Kernova project.
 *
 * Usage (via CLI):
 *   kernova create my-support-app
 *
 * Generates:
 *   my-support-app/
 *   ├── app/              (Next.js frontend)
 *   ├── agents/           (Agent definitions)
 *   ├── agents/tools/     (Custom tools)
 *   ├── memory/           (Memory schemas)
 *   ├── middleware/        (Request middleware)
 *   ├── kernova.config.ts (Project config)
 *   ├── package.json
 *   └── tsconfig.json
 */

export { scaffoldProject } from './scaffold.js';
export type { ScaffoldOptions } from './scaffold.js';
