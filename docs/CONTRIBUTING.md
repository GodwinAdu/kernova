# Contributing to Nexus

> This guide covers how to contribute to Nexus — whether you're a human developer or an AI coding assistant.

---

## The Golden Rule

> Nothing gets built unless documentation already defines it.

This sounds slow. It isn't. It prevents months of rework.

---

## Before You Write Code

1. **Check `docs/PROGRESS.md`** — Is this already planned? Is it in progress?
2. **Check `AGENT.md`** — Does the feature fit within the Seven Pillars?
3. **Write a spec** — Create `docs/specs/your-feature.md` describing what and why
4. **Create an ADR** — If this is an architectural decision, document it in `docs/decisions/`
5. **Then implement** — Now you can write code with confidence

---

## Development Setup

```bash
# Clone the repo
git clone <repo-url>
cd nexus

# Install dependencies
npm install

# Build all packages (order matters)
npx tsc --project packages/types/tsconfig.json
npx tsc --project packages/core/tsconfig.json
npx tsc --project packages/cli/tsconfig.json

# Verify CLI works
node packages/cli/dist/bin.js --help
```

---

## Build Order

Packages must be built in dependency order:

```
@nexus/types  →  @nexus/core  →  @nexus/cli
```

If you change types, you must rebuild everything downstream.

---

## Code Checklist

Before submitting code, verify:

- [ ] File has a module-level JSDoc comment
- [ ] All public functions/classes are documented
- [ ] No `any` types (use `unknown` if truly unknown)
- [ ] No magic numbers/strings
- [ ] Error messages are helpful and actionable
- [ ] Events are emitted for state changes
- [ ] The feature fits one of the Seven Pillars
- [ ] Types are defined in `@nexus/types` (not inline)
- [ ] Imports use `.js` extension for relative paths
- [ ] Code compiles without errors

---

## Commit Messages

Format: `<scope>: <description>`

Scopes:
- `types` — Changes to @nexus/types
- `core` — Changes to @nexus/core
- `cli` — Changes to @nexus/cli
- `docs` — Documentation changes
- `infra` — Build, CI, tooling changes

Examples:
```
types: add Tool interface to object model
core: implement SQLite memory persistence
cli: add nexus deploy command
docs: write workflow engine spec
infra: add vitest configuration
```

---

## Adding a New Feature

1. Create spec: `docs/specs/<feature-name>.md`
2. Add types: `packages/types/src/<domain>.ts`
3. Implement: `packages/core/src/<domain>/`
4. Add CLI support (if applicable): `packages/cli/src/commands/`
5. Update progress: `docs/PROGRESS.md`
6. Add ADR if architectural: `docs/decisions/`

---

## Adding a New Object Type

Every new object MUST:
1. Be defined in `@nexus/types`
2. Extend `NexusObject`
3. Follow the Nexus Laws (identity, permissions, events, history, etc.)
4. Be exported from the package index

---

## Questions to Ask Before Any Feature

1. **Who will use it?** — Developer? End user? Agent?
2. **What problem does it solve today?** — Not in theory. Today.
3. **Why can't existing tools solve it?** — What's genuinely new?
4. **How will we measure adoption?** — How do we know it's working?

If you can't answer these, postpone the feature.
