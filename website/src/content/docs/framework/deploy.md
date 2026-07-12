---
title: Deploy to Kernova Cloud
description: Ship your agent app to production with one command.
---

# Deploy to Kernova Cloud

## Prerequisites

1. A Kernova Cloud account → [Sign up at cloud.kernova.app](https://cloud.kernova.app)
2. An API key → Create one in Dashboard → Settings

## Login

```bash
kernova login --key kn_live_your_api_key_here
```

This saves your credentials to `~/.kernova/credentials.json`.

## Deploy

From your project directory:

```bash
kernova deploy
```

That's it. The CLI will:

1. Build your frontend (`next build`)
2. Package your agents
3. Upload to Kernova Cloud
4. Provision a container on Render
5. Inject your secrets as environment variables
6. Start the health check
7. Return your live URL

```
  ✅ Deployed successfully

  URL:     https://my-app.kernova.app
  Status:  live
  Time:    12s
```

## What Gets Deployed

| Part | Where | What Happens |
|------|-------|-------------|
| `app/` (frontend) | CDN + Edge | Static assets served globally |
| `agents/` (backend) | Render container | Long-running process with your agents |
| `memory/` | Container volume | Schemas loaded at startup |
| Secrets | Injected as env vars | From your Kernova Cloud vault |

## Deploy Options

```bash
# Deploy everything (default)
kernova deploy

# Deploy only agents (skip frontend)
kernova deploy --agents-only

# Deploy only frontend
kernova deploy --app-only

# Specify region
kernova deploy --region eu-west-1
```

## Regions

| Region | Location |
|--------|----------|
| `us-east-1` | Ohio, US (default) |
| `us-west-2` | Oregon, US |
| `eu-west-1` | Frankfurt, Germany |
| `ap-southeast-1` | Singapore |

## Environment Variables

Secrets you add in Dashboard → Secrets are automatically injected into your deployment as environment variables. Your agents can access them:

```typescript
// In your tools
execute: async (params, ctx) => {
  const apiKey = ctx.env.MY_SECRET_KEY; // ← from Kernova Cloud vault
}
```

## Custom Domains

After deploying, add a custom domain in Dashboard → Projects → [Your Project] → Domains:

1. Add your domain (e.g., `agents.mycompany.com`)
2. Create a CNAME record pointing to `cname.kernova.app`
3. Wait for DNS propagation
4. Domain is verified automatically

## Plans & Limits

| Plan | Deployments/mo | Instance Type |
|------|---------------|---------------|
| Hobby (free) | 10 | Shared (sleeps after 15min) |
| Pro ($29/mo) | 100 | Always-on, 512MB RAM |
| Team ($79/mo) | 500 | Always-on, 2GB RAM |
| Enterprise | Unlimited | Dedicated, 4GB+ RAM |

## Checking Deployment Status

```bash
# The CLI polls automatically after deploy
# You can also check manually:
curl -H "Authorization: Bearer kn_live_xxx" \
  https://cloud.kernova.app/api/deploy/DEPLOYMENT_ID
```

## Self-Hosting

If you prefer to host yourself:

```bash
# Generate Docker artifacts
kernova deploy docker

# Build and run
docker build -t my-app .
docker run -p 3000:3000 --env-file .env.local my-app
```

Or use the Node.js entry:

```bash
kernova deploy node
kernova build
NODE_ENV=production npx tsx start.ts
```

## Rollbacks

If a deployment fails, the previous version stays live. Kernova Cloud never takes down a working deployment for a failed one.

To manually roll back, redeploy a previous commit:

```bash
git checkout previous-tag
kernova deploy
```
