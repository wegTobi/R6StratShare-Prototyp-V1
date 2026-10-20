FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.16.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build:selfhost

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
# Vinext currently lives in devDependencies; retain its runtime dependencies.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/scripts/selfhost.mjs ./scripts/selfhost.mjs
USER node
EXPOSE 3000
CMD ["node", "scripts/selfhost.mjs", "start"]
