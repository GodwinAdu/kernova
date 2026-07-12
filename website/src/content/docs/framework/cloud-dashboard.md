---
title: Cloud Dashboard Guide
description: Navigate the Kernova Cloud dashboard — projects, deployments, monitoring, billing.
---

# Cloud Dashboard Guide

The Kernova Cloud dashboard at [cloud.kernova.app](https://cloud.kernova.app) is where you manage your deployed projects, monitor health, configure secrets, and handle billing.

## Signing Up

1. Go to [cloud.kernova.app](https://cloud.kernova.app)
2. Click **"Sign Up"**
3. Create an account with email or OAuth (Google, GitHub)
4. You're automatically redirected to the dashboard

On first sign-in, a workspace and organization are created for you automatically.

## Dashboard Overview

The main dashboard shows:

- **Active Projects** — How many projects you have deployed
- **Total Deployments** — All-time deployment count
- **Plan** — Your current billing plan
- **Team Members** — People in your organization
- **Recent Projects** — Quick access to your latest projects with deployment status

## Sidebar Navigation

| Section | What It Does |
|---------|-------------|
| **Overview** | Dashboard home with stats |
| **Projects** | List all projects, create new ones |
| **Deployments** | History of all deployments across projects |
| **Monitoring** | Deployment health, success rates, build times |
| **Activity** | Audit log of all events (deploys, changes) |
| **Marketplace** | Browse available tools and integrations |
| **Organization** | Manage team members and roles |
| **Secrets** | Environment variables for your deployments |
| **Billing** | Plan management, usage, invoices |
| **Security** | API keys overview and auth status |
| **Settings** | Profile, API key creation/management |

## Projects

### Creating a Project

Two ways:

**From the dashboard:**
1. Click **"New Project"** button
2. Enter a name (lowercase, hyphens only — becomes your URL slug)
3. Add optional description
4. Select a region
5. Click **"Create"**

**From the CLI (auto-creates on first deploy):**
```bash
kernova deploy
# If the project doesn't exist yet, it's created automatically
```

### Project Detail Page

Click any project to see:

- **Overview** — Status, region, URL, deployment count, recent deploys
- **Logs** — Build logs for each deployment
- **Domains** — Default `.kernova.app` domain + custom domains
- **Settings** — Edit description, delete project

### Project Status

| Status | Meaning |
|--------|---------|
| 🟢 running | Last deployment succeeded, service is live |
| 🟡 idle | Project exists but hasn't been deployed yet |
| 🔴 stopped | Project paused or deleted |

## Deployments

The Deployments page shows all deploys across all projects, sorted by most recent.

Each entry shows:
- Project name
- Environment (production/staging)
- Commit message
- Status indicator (success/building/failed)
- Duration
- Who deployed it
- Link to open the live URL

### Deployment Statuses

| Status | Meaning |
|--------|---------|
| ⚪ Queued | Deployment received, waiting to build |
| 🟡 Building | Container is being built |
| 🟡 Deploying | Built successfully, starting up |
| 🟢 Success | Live and healthy |
| 🔴 Failed | Build or startup failed (check logs) |

## Secrets

Secrets are environment variables injected into your deployments at runtime.

### Adding a Secret

1. Go to **Secrets** in the sidebar
2. Click **"Add Secret"**
3. Enter the key name (e.g., `OPENAI_API_KEY`) — auto-uppercased
4. Enter the value
5. Click **"Save"**

Secrets are encrypted at rest. Values are never displayed after saving.

### Scopes

- **All projects** — Injected into every deployment in your org
- **Project-specific** — Only injected into a specific project (set via API)

### When secrets take effect

Secrets are injected on the next deployment. If you add/change a secret, redeploy for it to take effect:

```bash
kernova deploy
```

## Billing

### Plans

| Plan | Price | Projects | Deployments/mo |
|------|-------|----------|----------------|
| Hobby | Free | 3 | 10 |
| Pro | $29/mo | 10 | 100 |
| Team | $79/mo | 50 | 500 |
| Enterprise | Custom | Unlimited | Unlimited |

### Upgrading

1. Go to **Billing**
2. Click **"Upgrade to Pro"** (or Team)
3. Complete Stripe checkout
4. Plan activates immediately

### Managing Subscription

Click **"Manage Subscription"** to open Stripe's customer portal where you can:
- Update payment method
- View invoices
- Cancel subscription
- Switch plans

### Usage

The billing page shows real-time usage:
- Projects used vs limit
- Deployments this month vs limit

If you hit a limit, deploys are blocked until you upgrade or wait for the next billing cycle.

## API Keys

### Creating a Key

1. Go to **Settings**
2. Click **"Create Key"**
3. Give it a name (e.g., "CI/CD Pipeline")
4. **Copy the key immediately** — it's only shown once
5. Use it with `kernova login --key kn_live_xxxxx`

### Key Security

- Keys are hashed (SHA-256) before storage — we never store the plain key
- Use separate keys for different environments (local dev, CI, production)
- Revoke keys you no longer use
- Keys show "Last used" timestamp so you can identify inactive ones

### Revoking a Key

Click the trash icon next to any key in Settings. This is immediate and irreversible — any CLI using that key will stop working.

## Organization

### Inviting Members

1. Go to **Organization**
2. Click **"Invite"**
3. Enter their email
4. They receive an invitation to join your workspace

### Roles

| Role | Permissions |
|------|-------------|
| Owner | Full access, billing, delete org |
| Admin | Manage projects, members, secrets |
| Member | Deploy, view projects |
| Viewer | View only (no deploys) |

## Monitoring

The monitoring page shows real-time health of your deployments:

- **Deployments this month** — Total count
- **Success rate** — Percentage of deploys that succeeded
- **Failed** — Count of failed deploys
- **Avg Build Time** — How long deploys take

Below that:
- **Project Health** — Green/red indicator per project
- **Recent Activity** — Timeline of events from the last 7 days
