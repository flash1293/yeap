FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/pwa/package.json ./packages/pwa/

RUN pnpm install --frozen-lockfile --filter @yeap/shared --filter @yeap/pwa

COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY packages/pwa/ ./packages/pwa/

RUN pnpm --filter @yeap/shared build
RUN pnpm --filter @yeap/pwa build

FROM nginx:alpine AS final
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/pwa/dist /usr/share/nginx/html

EXPOSE 80
