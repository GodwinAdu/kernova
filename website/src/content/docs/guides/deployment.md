---
title: Deploying to Production
description: Deploy your Kernova application with Docker or Node.js.
---

# Deploying to Production

## Using the CLI

```bash
# Generate Docker deployment files
Kernova deploy docker

# Or generate a Node.js production entry
Kernova deploy node
```

## Docker Deployment

After running `Kernova deploy docker`:

```bash
npm run build
docker build -t my-app .
docker run -p 4200:4200 \
  -e OPENAI_API_KEY=sk-... \
  -e Kernova_AUTH=true \
  -v ./data:/app/Kernova-data \
  my-app
```

The generated Dockerfile uses Node.js 24 Alpine, installs only production dependencies, and exposes port 4200.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Studio/API port | 4200 |
| `Kernova_DATA_DIR` | Persistence directory | ./Kernova-data |
| `Kernova_AUTH` | Require auth for API | true |
| `NODE_ENV` | Environment | production |
| Provider keys | See [Providers](/guides/providers) | — |

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set `Kernova_AUTH=true` (enforces API key auth)
- [ ] Use a persistent volume for `Kernova-data/`
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
