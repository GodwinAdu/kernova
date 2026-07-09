---
title: Deploying to Production
description: Deploy your Nexus application with Docker or Node.js.
---

# Deploying to Production

## Using the CLI

```bash
# Generate Docker deployment files
nexus deploy docker

# Or generate a Node.js production entry
nexus deploy node
```

## Docker Deployment

After running `nexus deploy docker`:

```bash
npm run build
docker build -t my-app .
docker run -p 4200:4200 \
  -e OPENAI_API_KEY=sk-... \
  -e NEXUS_AUTH=true \
  -v ./data:/app/nexus-data \
  my-app
```

The generated Dockerfile uses Node.js 20 Alpine, installs only production dependencies, and exposes port 4200.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Studio/API port | 4200 |
| `NEXUS_DATA_DIR` | Persistence directory | ./nexus-data |
| `NEXUS_AUTH` | Require auth for API | true |
| `NODE_ENV` | Environment | production |
| Provider keys | See [Providers](/guides/providers) | — |

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `NEXUS_AUTH=true` (enforces API key auth)
- [ ] Use a persistent volume for `nexus-data/`
- [ ] Set model provider API keys
- [ ] Configure budget limits
- [ ] Set up TLS (reverse proxy or `tlsCert`/`tlsKey`)
- [ ] Configure event retention (`applyRetention(30)`)

## Health Check

The `/health` endpoint returns `200 OK` without authentication — use it for load balancer probes:

```
GET /health → { "status": "healthy", "timestamp": "..." }
```

## Scaling

v0.1 is single-process. For scaling:
- Use a reverse proxy (nginx) for TLS and load balancing
- Run multiple instances with shared PostgreSQL (planned for v0.2)
- Use Redis for distributed event bus (planned for v0.3)
