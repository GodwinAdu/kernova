# Kernova Runtime Docker Image
# This is the base image that runs user's Kernova agent projects on Render
#
# Usage: docker build -t kernova/runtime .
# The user's project code is mounted/added at /app

FROM node:24-alpine

WORKDIR /app

# Install global dependencies
RUN npm install -g @kernova/cli@latest @kernova/framework@latest @kernova/core@latest tsx

# Default port
ENV PORT=4555
ENV NODE_ENV=production
EXPOSE 4555

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4555/health || exit 1

# Start command — runs the Kernova agent server
CMD ["sh", "-c", "npx tsx -e \"import { createServer } from '@kernova/framework/server'; createServer({ port: parseInt(process.env.PORT || '4555') });\""]
