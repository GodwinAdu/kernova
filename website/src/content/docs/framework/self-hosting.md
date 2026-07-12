---
title: Self-Hosting
description: Run Kernova on your own infrastructure without Kernova Cloud.
---

# Self-Hosting

You don't have to use Kernova Cloud. The framework runs anywhere Node.js runs.

## Option 1: Docker (Recommended)

Generate a Dockerfile:

```bash
kernova deploy docker
```

This creates:

```dockerfile
# Multi-stage: build frontend + run agents
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx next build

FROM node:20-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY --from=frontend-build /app/.next ./.next
COPY --from=frontend-build /app/public ./public
COPY agents/ ./agents/
COPY memory/ ./memory/
COPY kernova.config.ts ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "node_modules/.bin/kernova", "start"]
```

Build and run:

```bash
docker build -t my-agent-app .
docker run -p 3000:3000 --env-file .env.production my-agent-app
```

## Option 2: Node.js Direct

```bash
kernova build
kernova start --port 3000
```

Or generate a standalone entry:

```bash
kernova deploy node
```

Then run:

```bash
NODE_ENV=production npx tsx start.ts
```

## Option 3: Docker Compose

For a complete setup with a database:

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/kernova
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=kernova
      - POSTGRES_PASSWORD=postgres
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

```bash
docker compose up -d
```

## Deploying to Popular Platforms

### Railway

```bash
# Push your repo to GitHub, then:
# 1. Connect Railway to your GitHub repo
# 2. Set environment variables in Railway dashboard
# 3. Railway auto-detects the Dockerfile and deploys
```

### Fly.io

```bash
fly launch
fly secrets set OPENAI_API_KEY=sk-xxx
fly deploy
```

### DigitalOcean App Platform

```bash
# 1. Connect your GitHub repo
# 2. Select "Dockerfile" as the build method
# 3. Set env vars in the dashboard
# 4. Deploy
```

### AWS (ECS / Fargate)

```bash
# Build and push to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URL
docker build -t my-app .
docker tag my-app:latest $ECR_URL/my-app:latest
docker push $ECR_URL/my-app:latest

# Deploy via ECS task definition
```

## Health Check

All platforms need to know your app is healthy. The agent server exposes:

```
GET /health → 200 OK
```

Response:
```json
{
  "status": "healthy",
  "name": "my-app",
  "agents": [{"route": "support", "name": "Support Agent"}],
  "uptime": 3600
}
```

Configure your platform's health check to hit this endpoint.

## Data Persistence

By default, memory and events are stored in SQLite at `./kernova-data/`. For self-hosted deployments:

- **Docker**: Mount a volume at `/app/kernova-data`
- **Kubernetes**: Use a PersistentVolumeClaim
- **Serverless**: Won't work (data lost on restart) — use an external database

## Scaling

The framework server is stateful (it holds conversation memory in SQLite). For horizontal scaling:

1. Use an external database (PostgreSQL) for memory instead of local SQLite
2. Use sticky sessions (route same user to same instance)
3. Or run a single instance with vertical scaling (bigger machine)

For most agent workloads, a single instance handles thousands of concurrent conversations.
