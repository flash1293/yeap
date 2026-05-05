# ── Stage 1: build the plugin ─────────────────────────────────────────────────
FROM node:22-alpine AS plugin-build

WORKDIR /app

COPY packages/ ./packages/
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json .npmrc ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile

RUN pnpm --filter @yeap/shared build
RUN pnpm --filter @yeap/plugin build

# ── Stage 2: final runtime image ──────────────────────────────────────────────
FROM node:22 AS final

# Install opencode globally (postinstall downloads the Go binary — needs glibc, not musl)
RUN npm install -g opencode-ai@latest

# Install OpenAI-compatible provider SDK for LiteLLM / custom proxies
RUN npm install -g @ai-sdk/openai-compatible@latest

# Install git (needed by git tools in the plugin)
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Copy the compiled plugin to the location opencode reads plugins from
RUN mkdir -p /root/.config/opencode/plugins
COPY --from=plugin-build /app/packages/plugin/dist/yeap.js /root/.config/opencode/plugins/yeap.js

# Copy entrypoint
COPY infra/bot-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 4096

ENTRYPOINT ["/entrypoint.sh"]
