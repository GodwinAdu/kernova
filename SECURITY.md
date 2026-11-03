# Security Policy

Kernova runs AI agents that can call tools, execute shell commands in a sandbox, read and write files, and handle API keys. We take security reports seriously and appreciate responsible disclosure.

## Supported versions

Security fixes are released for the latest minor version of each published package:

| Package | Supported |
|---------|-----------|
| `@kernova/core` | latest |
| `@kernova/sdk` | latest |
| `@kernova/framework` | latest |
| `@kernova/cli` | latest |
| `@kernova/types` | latest |
| `create-kernova-app` | latest |

If you're on an older version, upgrade before reporting, if you can.

## Reporting a vulnerability

**Do not open a public GitHub issue, discussion, or pull request for security vulnerabilities.**

Report privately through GitHub:

1. Go to the [Security tab](https://github.com/GodwinAdu/kernova/security) of this repository.
2. Click **Report a vulnerability** ([direct link](https://github.com/GodwinAdu/kernova/security/advisories/new)).
3. Describe the issue.

Please include:

- The affected package(s) and version(s)
- A description of the vulnerability and its impact
- Steps to reproduce, or a proof of concept
- Any suggested fix or mitigation

## What to expect

- **Acknowledgement** within 3 business days
- **Initial assessment** within 7 days, including whether we accept the report and its severity
- **Fix and disclosure.** We'll work on a fix, keep you updated, and coordinate a disclosure date with you. Critical issues are prioritized.
- **Credit.** With your permission, we'll credit you in the advisory and release notes.

## Scope

Examples of issues we especially want to hear about:

- Escaping the built-in tool sandboxes (`file-read` and `file-write` paths, `code-eval` isolation), or `http-fetch` reaching private addresses (note: `shell-exec` is documented as not a sandbox)
- Authentication or authorization bypass in the gateway, API keys, sessions, or permissions
- Leaking API keys, secrets, or other users' memory and conversation data
- Prompt-injection paths that let untrusted input trigger privileged tools without the configured approvals
- Remote code execution or server-side request forgery in the agent server or channel adapters

Out of scope:

- Vulnerabilities in third-party model providers themselves
- Issues that require a malicious project configuration the developer wrote themselves
- Missing security headers or best-practice suggestions without a demonstrated impact

## Security best practices for users

- Never commit `.env` / `.env.local` files or API keys.
- Set `KERNOVA_API_KEY` (or use the identity system) before exposing an agent server to the internet.
- Keep the unsafe built-in tools (`shell-exec`, `code-eval`, `file-read`, `file-write`, `database-query`) disabled unless an agent needs them, and use `toolPolicy` to limit which agents can call them. They're off by default.
- Use budgets and rate limits to cap cost and abuse.

See the [security guide](https://kernova2026.vercel.app/guides/security/) for more.
