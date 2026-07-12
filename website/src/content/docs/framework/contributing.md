---
title: Contributing
description: How to contribute to the Kernova Framework — bug fixes, features, docs.
---

# Contributing to Kernova

We welcome contributions! Whether it's bug fixes, new features, documentation improvements, or community tools.

## Repository Structure

The Kernova ecosystem is a monorepo:

```
nexus/
├── packages/
│   ├── core/           # @kernova/core — Agent runtime engine
│   ├── types/          # @kernova/types — Shared type definitions
│   ├── sdk/            # @kernova/sdk — Client SDK
│   ├── cli/            # @kernova/cli — Developer CLI
│   ├── framework/      # @kernova/framework — Full-stack framework
│   ├── studio/         # @kernova/studio — Admin dashboard
│   └── create-kernova-app/  # npx create-kernova-app
├── sdks/
│   ├── go/             # Go client SDK
│   └── swift/          # Swift client SDK
├── website/            # Documentation (Astro Starlight)
├── examples/           # Example projects
└── docs/               # Design documents
```

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Git

### Setup

```bash
# Clone the repo
git clone https://github.com/kernova/kernova.git
cd kernova

# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test
```

### Development

```bash
# Watch mode for a specific package
cd packages/framework
npm run dev

# Run the whole monorepo in dev mode
npm run dev
```

## Making Changes

### 1. Fork and Branch

```bash
git checkout -b feature/my-feature
# or
git checkout -b fix/issue-123
```

### 2. Make Your Changes

Follow the existing code style:
- TypeScript strict mode
- ES modules (`import`/`export`)
- Functional style where possible
- JSDoc comments on public APIs

### 3. Test

```bash
# Run all tests
npm test

# Run tests for a specific package
cd packages/framework
npm test

# Type check
npx tsc --noEmit
```

### 4. Commit

Use conventional commits:

```
feat: add webhook support to defineAgent
fix: resolve memory leak in dev server hot reload
docs: add streaming deep dive guide
chore: update dependencies
```

### 5. Submit a Pull Request

Push your branch and open a PR against `main`. Include:
- What the change does
- Why it's needed
- How to test it

## Contribution Areas

### Bug Fixes

Found a bug? Check [existing issues](https://github.com/kernova/kernova/issues) first, then:

1. Create a minimal reproduction
2. Open an issue describing the bug
3. Submit a PR with the fix + a test that would have caught it

### New Features

For significant features, open an issue first to discuss the approach. This saves everyone time.

Good first features to contribute:
- New tool definitions (e.g., `@kernova/tool-slack`, `@kernova/tool-github`)
- Additional React hooks or UI components
- CLI improvements
- Documentation pages

### Documentation

Docs live in `website/src/content/docs/`. They use Markdown with Astro Starlight.

To run the docs site locally:
```bash
cd website
npm install
npm run dev
```

### Examples

Add example projects to `examples/`:
```
examples/
├── support-bot/      # Customer support agent
├── research-agent/   # Paper research pipeline
└── your-example/     # Your new example
```

Each example should have:
- A `README.md` explaining what it does
- Working code that runs with `kernova dev`
- Minimal dependencies

## Code Guidelines

### TypeScript

- Use strict types (no `any` unless absolutely necessary)
- Export types alongside implementations
- Use `interface` for shapes, `type` for unions/intersections

### Naming

- Files: `kebab-case.ts`
- Functions: `camelCase`
- Classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Types/Interfaces: `PascalCase`

### Testing

- Use Vitest (configured at repo root)
- Co-locate tests with source: `my-module.ts` → `my-module.test.ts`
- Test behavior, not implementation details
- Mock external services (LLM APIs, databases)

### Error Handling

- Use descriptive error messages that tell the user what to do
- Never swallow errors silently
- Use typed errors where possible

## Release Process

Maintainers handle releases:

1. Changes accumulate on `main`
2. Version bumped across all packages
3. Changelog generated from conventional commits
4. Published to npm: `npm run publish:all`

## Community

- **GitHub Issues** — Bug reports and feature requests
- **GitHub Discussions** — Questions and ideas
- **Discord** — Real-time chat (coming soon)

## License

Kernova is MIT licensed. All contributions are made under the same license.

---

Thank you for contributing! Every improvement helps developers build better AI applications.
