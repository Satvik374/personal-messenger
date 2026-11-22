# Build from the repository root:
#   docker build -f apps/server/Dockerfile -t personal-messenger .
# The build context must be the repo root so packages/shared can be copied in.

FROM node:24-slim

WORKDIR /app

# Manifests first so dependency installation is cached independently of source edits.
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY apps/server/package.json ./apps/server/package.json
COPY apps/server/tsconfig.json ./apps/server/tsconfig.json

WORKDIR /app/apps/server
RUN npm install --no-audit --no-fund

COPY packages/shared/src ./../../packages/shared/src
COPY apps/server/src ./src

RUN npm run build

ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "dist/index.js"]
