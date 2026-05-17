FROM node:22-alpine

RUN apk add --no-cache \
    git \
    bash \
    curl \
    wget \
    python3 \
    py3-pip \
    jq \
    ca-certificates \
    openssh-client \
    rsync

WORKDIR /app

COPY packages/ ./packages/
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
# .npmrc is optional
COPY .npmrc* ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile
RUN pnpm --filter @yeap/shared build
RUN pnpm --filter @yeap/agent build

COPY infra/agent-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 4096

ENTRYPOINT ["/entrypoint.sh"]
