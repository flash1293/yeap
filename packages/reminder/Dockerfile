FROM node:22-alpine AS build
WORKDIR /app
COPY packages/ ./packages/
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json .npmrc ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
RUN pnpm --filter @yeap/shared build
RUN pnpm --filter @yeap/reminder build
RUN pnpm deploy --filter @yeap/reminder --prod /app/deployed

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/deployed/node_modules ./node_modules
COPY --from=build /app/packages/reminder/dist ./dist
RUN mkdir -p /data /shared/chat /shared/work /shared/yeap-docs
CMD ["node", "dist/index.js"]
