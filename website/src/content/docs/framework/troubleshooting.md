---
title: Troubleshooting
description: Solutions to common issues when developing with the Kernova Framework.
---

# Troubleshooting

## Installation & Setup

### `npx create-kernova-app` fails with permission errors

**Cause:** npm doesn't have write access to the directory.

**Fix:**
```bash
# On Mac/Linux:
sudo npx create-kernova-app my-app

# Or fix npm permissions:
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
```

On Windows, run your terminal as Administrator.

---

### `kernova: command not found`

**Cause:** The CLI isn't installed globally or not in PATH.

**Fix:**
```bash
# Install globally:
npm install -g @kernova/cli

# Or use npx:
npx @kernova/cli dev
```

If installed but still not found, check your PATH includes the npm global bin:
```bash
npm bin -g
# Add that path to your system PATH
```

---

### `No kernova.config.json or kernova.config.ts found`

**Cause:** You're running `kernova dev` from the wrong directory.

**Fix:** Make sure you're inside your project folder:
```bash
cd my-app
kernova dev
```

---

## Development Server

### `Error: OPENAI_API_KEY is not set`

**Cause:** Missing API key in `.env.local`.

**Fix:** Create or edit `.env.local` in your project root:
```bash
OPENAI_API_KEY=sk-proj-your-key-here
```

Get a key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys).

---

### `Error: listen EADDRINUSE: address already in use :::3000`

**Cause:** Another process is using port 3000 (maybe a previous dev server didn't shut down).

**Fix:**
```bash
# Find and kill the process (Windows):
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Find and kill the process (Mac/Linux):
lsof -i :3000
kill -9 <PID>

# Or use a different port:
kernova dev --port 3001
```

---

### `Error: listen EADDRINUSE: address already in use :::4555`

**Cause:** The agent backend port is already in use.

**Fix:**
```bash
kernova dev --agent-port 4556
```

---

### Agent returns empty response or errors

**Cause:** Usually the LLM call fails silently.

**Fixes to check:**
1. Is your `OPENAI_API_KEY` valid? Test it:
   ```bash
   curl https://api.openai.com/v1/models -H "Authorization: Bearer sk-proj-xxx"
   ```
2. Do you have billing enabled on your OpenAI account?
3. Check the terminal — the agent server logs errors there.
4. Is the model name correct in `kernova.config.ts`? (e.g., `gpt-4o` not `gpt4o`)

---

### `Module not found: Can't resolve '@kernova/framework'`

**Cause:** Dependencies weren't installed.

**Fix:**
```bash
npm install
```

If still failing:
```bash
rm -rf node_modules package-lock.json
npm install
```

---

### Hot reload not working (changes to agents/ don't take effect)

**Cause:** File watcher may not pick up changes in some environments.

**Fix:** Restart the dev server:
```bash
# Press Ctrl+C to stop
kernova dev
```

On Windows with WSL or network drives, file watching can be slow. Move your project to a local drive.

---

## React Hooks

### `useKernovaContext: Must be used within a <KernovaProvider>`

**Cause:** You're using a hook (`useAgent`, `useAgentStream`, etc.) outside of the provider.

**Fix:** Make sure your `app/layout.tsx` wraps children with `KernovaProvider`:

```tsx
import { KernovaProvider } from '@kernova/framework/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <KernovaProvider>
          {children}
        </KernovaProvider>
      </body>
    </html>
  );
}
```

---

### `Agent request failed (404): Not found`

**Cause:** The hook is calling an agent name that doesn't match any file.

**Fix:** Check that:
1. Your agent file is named correctly: `agents/support.agent.ts` for `useAgent('support')`
2. The file exports a `defineAgent()` as the default export
3. The dev server discovered it (check terminal for "Agents: X discovered")

---

### `Agent request failed (500): Internal server error`

**Cause:** The agent crashed during execution.

**Fix:** Check the terminal running `kernova dev` — it will show the full error stack trace. Common causes:
- Tool execution threw an error
- LLM API returned an error (rate limit, invalid key)
- Agent instructions caused an infinite tool-calling loop

---

### Streaming not working (response arrives all at once)

**Cause:** You might be using `useAgent` instead of `useAgentStream`.

**Fix:**
```tsx
// For streaming (token-by-token):
const { messages, send, streamingContent } = useAgentStream('support');

// For non-streaming (wait for full response):
const { messages, send } = useAgent('support');
```

Also check that your proxy rewrites are working in `next.config.ts`.

---

## Tools

### `Tool "my-tool" not found`

**Cause:** The tool file isn't being discovered.

**Fix:** Check that:
1. The file is in `agents/tools/` or `tools/`
2. It exports a `defineTool()` as the default export
3. The `name` field in `defineTool()` matches what the agent references
4. The file extension is `.ts` or `.js`

---

### Tool executes but agent ignores the result

**Cause:** The tool's description doesn't tell the LLM how to use the result.

**Fix:** Make your tool description explicit about what it returns:

```typescript
// Bad:
description: 'Search things'

// Good:
description: 'Search the knowledge base and return relevant articles. Use the article content to answer the user\'s question.'
```

---

### Tool called repeatedly in a loop

**Cause:** The agent keeps calling the same tool because it's not satisfied with the result.

**Fix:**
1. Make sure your tool returns clear, useful results
2. Add `maxTokens` to your agent to limit response length
3. Add a `rateLimit` to the tool to prevent spam:
   ```typescript
   defineTool({ rateLimit: 5, ... }) // Max 5 calls per minute
   ```

---

## Deployment

### `kernova deploy` says "Missing API key. Use: kernova login"

**Cause:** You haven't authenticated with Kernova Cloud.

**Fix:**
```bash
kernova login --key kn_live_your_key_here
```

Get a key from [cloud.kernova.app/dashboard/settings](https://cloud.kernova.app/dashboard/settings).

---

### Deploy fails with "Project limit reached"

**Cause:** You've hit your plan's project limit.

**Fix:** Either:
- Delete an unused project in the dashboard
- Upgrade your plan at Dashboard → Billing

---

### Deploy succeeds but app returns 502/503

**Cause:** The container started but the app crashed or isn't listening on the right port.

**Fix:**
1. Check build logs in Dashboard → Projects → [Your Project] → Logs
2. Make sure your `.env` secrets are set in Dashboard → Secrets
3. Verify the health check works: `curl https://your-app.kernova.app/health`
4. The app must listen on port `4555` (this is configured automatically)

---

### `Error: Cannot find module '@kernova/framework'` in production

**Cause:** Dependencies weren't installed in the build step.

**Fix:** Make sure `@kernova/framework` is in `dependencies` (not `devDependencies`) in your `package.json`:

```json
{
  "dependencies": {
    "@kernova/framework": "^0.1.0",
    "@kernova/core": "^0.2.0"
  }
}
```

---

## Memory

### Memory not persisting between requests

**Cause:** You might be using `memory: { type: 'none' }` or the thread ID is changing.

**Fix:**
1. Check your agent has `memory: { type: 'conversational' }` or `'persistent'`
2. In your frontend, make sure you're not calling `clear()` accidentally
3. Verify the `threadId` stays consistent between messages (check with `console.log(threadId)`)

---

### `SQLITE_BUSY: database is locked`

**Cause:** Multiple processes are trying to write to the SQLite database simultaneously.

**Fix:**
- In development: make sure only one `kernova dev` is running
- In production: this shouldn't happen with a single instance. If using multiple instances, switch to PostgreSQL for memory storage

---

## General

### TypeScript errors after updating packages

**Fix:**
```bash
rm -rf node_modules/.cache
rm -rf .next
npm install
kernova dev
```

---

### "Slow filesystem detected" warning on Windows

**Cause:** Your project is on a network drive or cloud-synced folder (OneDrive, Dropbox).

**Fix:** Move your project to a local drive (e.g., `C:\Projects\my-app`).

---

### Everything was working, now nothing loads

**Checklist:**
1. Is the dev server running? (`kernova dev`)
2. Are there errors in the terminal?
3. Did you recently change `.env.local`? Restart the server.
4. Did `package.json` change? Run `npm install`.
5. Clear Next.js cache: delete `.next/` folder and restart.

---

## Getting Help

If your issue isn't listed here:

1. Check the terminal output — most errors show clear messages
2. Add `debug: true` to your `kernova.config.ts` for verbose logging
3. Open an issue on [GitHub](https://github.com/kernova/kernova)
4. Join our community Discord (coming soon)
