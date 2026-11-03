# Contributing to Kernova

Thanks for your interest in Kernova. Contributions of every size are welcome: bug reports, documentation fixes, new model providers, new channel adapters, and core features.

This guide covers everything from your first clone to a merged pull request.

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [Ways to contribute](#ways-to-contribute)
- [Before you start](#before-you-start)
- [Development setup](#development-setup)
- [Repository structure](#repository-structure)
- [Development workflow](#development-workflow)
- [Commit messages](#commit-messages)
- [Coding standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)
- [Pull request process](#pull-request-process)
- [Common contributions](#common-contributions)
- [Releasing (maintainers)](#releasing-maintainers)
- [Getting help](#getting-help)

---

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Ways to contribute

- **Report a bug.** [Open a bug report](https://github.com/GodwinAdu/kernova/issues/new?template=bug_report.yml) with steps to reproduce.
- **Suggest a feature.** [Open a feature request](https://github.com/GodwinAdu/kernova/issues/new?template=feature_request.yml) describing the problem it solves.
- **Improve the docs.** Fix a typo, clarify a guide, or add an example.
- **Write code.** Pick up an issue labeled [`good first issue`](https://github.com/GodwinAdu/kernova/labels/good%20first%20issue) or [`help wanted`](https://github.com/GodwinAdu/kernova/labels/help%20wanted).

Found a security vulnerability? **Don't open a public issue.** Follow [SECURITY.md](SECURITY.md).

## Before you start

**Small changes** (typos, docs, small bug fixes) can go straight to a pull request.

**Larger changes** (new features, new public APIs, architectural changes) should start with an issue, so we can agree on the approach before you invest time. Kernova follows a docs-first rule:

> Nothing gets built unless documentation already defines it.

For a new feature:

1. Check [`docs/PROGRESS.md`](docs/PROGRESS.md) to see whether it's already planned or in progress.
2. Write a spec in `docs/specs/<feature-name>.md` describing what it does and why.
3. If it's an architectural decision, add an ADR in [`docs/decisions/`](docs/decisions).
4. Then implement it.

Every feature should be able to answer these questions:

1. **Who will use it?** A developer, an end user, or an agent?
2. **What problem does it solve today?** Not in theory. Today.
3. **Why can't existing tools solve it?**
4. **How will we know it's working?**

## Development setup

### Prerequisites

- **Node.js 22 or newer** (see [`.nvmrc`](.nvmrc))
- **npm 10 or newer**
- **Git**
- **Native build tools** for `better-sqlite3`, which usually only matter if a prebuilt binary isn't available for your platform:
  - macOS: `xcode-select --install`
  - Linux: `build-essential` and `python3`
  - Windows: "Desktop development with C++" from Visual Studio Build Tools
- An API key for at least one model provider (for example `OPENAI_API_KEY`), but only to run examples against a real model. Tests don't need one.

### Fork and clone

1. [Fork the repository](https://github.com/GodwinAdu/kernova/fork) on GitHub.
2. Clone your fork and add the main repository as `upstream`:

   ```bash
   git clone https://github.com/<your-username>/kernova.git
   cd kernova
   git remote add upstream https://github.com/GodwinAdu/kernova.git
   ```

3. Install dependencies and build everything:

   ```bash
   npm install
   npm run build
   ```

4. Run the tests:

   ```bash
   npm test
   ```

5. Try the CLI from source:

   ```bash
   node packages/cli/dist/bin.js --help
   ```

## Repository structure

```
kernova/
├── packages/
│   ├── types/               # @kernova/types: shared type definitions (no runtime code)
│   ├── core/                # @kernova/core: the runtime kernel
│   ├── sdk/                 # @kernova/sdk: high-level API over core
│   ├── framework/           # @kernova/framework: full-stack framework and React hooks
│   ├── cli/                 # @kernova/cli: the `kernova` command
│   ├── kernova/             # kernova: alias package so `npx kernova` runs @kernova/cli
│   ├── create-kernova-app/  # project scaffolder
│   └── studio/              # Studio dashboard (Next.js static export, bundled into the CLI)
├── sdks/                    # HTTP client SDKs: Python, Go, Rust, Java, C#, Swift
├── examples/                # Runnable TypeScript examples
├── docs/                    # Design docs: vision, architecture, specs, protocols, ADRs
└── website/                 # Documentation site (Astro Starlight), published at kernova2026.vercel.app
```

The repo is an **npm workspaces** monorepo orchestrated by **Turborepo**.

### Build order

Packages depend on each other, so they build in this order (Turborepo handles it for you with `npm run build`):

```
@kernova/types → @kernova/core → @kernova/sdk
                               → @kernova/framework → create-kernova-app
                               → @kernova/cli → kernova
                @kernova/studio ↗
```

When you change `@kernova/types` or `@kernova/core`, rebuild so downstream packages pick up the changes. The CLI build copies Studio's static export (`packages/studio/out`) into `packages/cli/studio`, which is what `kernova studio` serves.

### Useful scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build all packages (Turborepo, cached) |
| `npm run dev` | Watch mode for all packages |
| `npm test` | Run all tests once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run clean` | Remove build outputs |
| `npm run build --workspace=@kernova/core` | Build a single package |
| `npm run dev --workspace=@kernova/core` | Watch a single package |

### Running examples

```bash
export OPENAI_API_KEY=sk-...
npx tsx examples/hello-kernova.ts
```

### Testing your changes in a real project

Pack the package you changed and install the tarball into a separate test app:

```bash
npm run build
cd packages/framework && npm pack            # creates kernova-framework-x.y.z.tgz
cd /path/to/test-app && npm install /path/to/kernova-framework-x.y.z.tgz
```

## Development workflow

1. **Sync with upstream** before starting:

   ```bash
   git checkout main
   git pull upstream main
   ```

2. **Create a branch** off `main` with a descriptive name:

   | Prefix | Use for | Example |
   |--------|---------|---------|
   | `feat/` | New features | `feat/mistral-streaming` |
   | `fix/` | Bug fixes | `fix/sdk-tool-calling-timeout` |
   | `docs/` | Documentation only | `docs/framework-hooks-guide` |
   | `refactor/` | Code changes that don't alter behavior | `refactor/model-router` |
   | `test/` | Adding or fixing tests | `test/task-queue-retries` |
   | `chore/` | Tooling, CI, dependencies | `chore/update-turbo` |

   ```bash
   git checkout -b feat/my-feature
   ```

3. **Make your changes**, with tests.
4. **Verify locally**: `npm run build && npm test`.
5. **Commit** following the [commit message format](#commit-messages).
6. **Push** to your fork and [open a pull request](https://github.com/GodwinAdu/kernova/compare) against `main`.

Keep pull requests focused. One logical change per PR is much easier to review than several bundled together.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `chore`, `ci`

**Scopes:** `types`, `core`, `sdk`, `framework`, `cli`, `create-app`, `studio`, `sdks`, `docs`, `examples`, `website`

```
feat(core): add Cerebras model provider
fix(framework): reconnect useAgentStream after network drop
docs(sdk): document builtInTools configuration
test(core): cover task queue dead-letter replay
chore(ci): run tests on Node 22
```

Use the imperative mood ("add", not "added"). Mark breaking changes with `!` and explain them in the body:

```
feat(sdk)!: rename ask() option `type` to `intentType`

BREAKING CHANGE: AskOptions.type is now AskOptions.intentType.
```

## Coding standards

- **TypeScript, ESM.** Relative imports use the `.js` extension (`import { x } from './foo.js'`).
- **Strict types.** Avoid `any`. Use `unknown` when a type is truly unknown, and narrow it.
- **Shared types live in `@kernova/types`.** Don't redefine them inline in other packages.
- **Document public APIs.** Every module has a top-level JSDoc comment, and every exported function or class has a doc comment.
- **No magic values.** Name your constants.
- **Helpful errors.** Error messages should say what went wrong and how to fix it.
- **Emit events for state changes.** Kernova is event-native, so new state transitions should go through the event bus.
- **Stay provider-agnostic.** Core features must work with any model provider, not just OpenAI.
- **Keep the build green.** `npm run build` must pass with no TypeScript errors.

## Testing

Tests use [Vitest](https://vitest.dev/) and live next to the code as `packages/<package>/src/**/*.test.ts`. Property-based tests use [fast-check](https://fast-check.dev/) and are named `*.property.test.ts`.

```bash
npm test                                   # everything
npx vitest run packages/core               # one package
npx vitest run packages/core/src/__tests__/event-bus.test.ts   # one file
npx vitest packages/sdk                    # watch mode
```

Guidelines:

- Every bug fix should include a test that fails without the fix.
- Every new feature should include tests for the main path and the important edge cases.
- Tests must not call real model APIs. Use `MockModelProvider` from `@kernova/core`.
- Use `ephemeral: true` or a temporary `dataDir` so tests don't write into the repo.

## Documentation

When your change affects users, update the docs in the same pull request:

- The package's `README.md` (it's what developers see on npm)
- The relevant page on the [documentation site](https://kernova2026.vercel.app). Its sources are Markdown files in [`website/src/content/docs/`](website/src/content/docs). Preview them with `npm install && npm run dev` inside `website/`.
- [`CHANGELOG.md`](CHANGELOG.md), under an `## [Unreleased]` heading

## Pull request process

1. Fill in the pull request template.
2. Make sure CI passes on all supported Node versions.
3. A maintainer will review your PR. Please respond to feedback, and push follow-up commits rather than force-pushing during review so changes are easy to follow.
4. Once approved, a maintainer will **squash-merge** it, so the PR title becomes the commit message. Make the title follow the [commit format](#commit-messages).

If your PR has been waiting for a week without a response, feel free to leave a polite comment.

## Common contributions

### Adding a model provider

Most providers are OpenAI-compatible and only need an entry in `packages/core/src/models/adapter-registry.ts` with `adapter: 'openai'`, a `baseUrl`, an `apiKeyEnv`, a `defaultModel`, and its `capabilities`. Copy an existing entry such as `groq`. Providers with a custom API get their own `*-provider.ts` in `packages/core/src/models/`. Make sure `kernova doctor` reports the new provider correctly.

### Adding a channel adapter

Add the adapter to `packages/core/src/channels/adapters/`, implement the `SDKChannelAdapter` interface from `@kernova/types`, export it from `packages/core/src/index.ts`, and add tests alongside it.

### Adding a built-in tool

Add it to `packages/core/src/built-in-tools/` and register it in that folder's `index.ts`. File and shell access must respect the sandbox directory.

### Adding a new object type

Every new object type must:

1. Be defined in `@kernova/types`
2. Extend `KernovaObject`
3. Be exported from the package index
4. Emit events for its lifecycle changes

## Releasing (maintainers)

1. Move `## [Unreleased]` entries in `CHANGELOG.md` to a new version heading.
2. Bump the version in each changed package's `package.json`, following [Semantic Versioning](https://semver.org/).
3. Build and publish in dependency order:

   ```bash
   npm run build
   npm publish --workspace=packages/types
   npm publish --workspace=packages/core
   npm publish --workspace=packages/sdk
   npm publish --workspace=packages/framework
   npm publish --workspace=packages/cli
   npm publish --workspace=packages/create-kernova-app
   npm publish --workspace=packages/kernova
   ```

   Only publish the packages whose version changed. Each package's `prepublishOnly` script rebuilds it first, so a stale `dist/` is never published.

4. Tag the release (`git tag v<version>`) and create a GitHub release with the changelog notes.

## Getting help

- Using Kernova: [documentation](https://kernova2026.vercel.app)
- Questions about using Kernova or contributing: [open an issue](https://github.com/GodwinAdu/kernova/issues/new/choose)
- Design background: [`docs/VISION.md`](docs/VISION.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

Thank you for helping make Kernova better.
