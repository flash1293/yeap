FROM node:20-alpine

RUN apk add --no-cache git python3 make g++

RUN git clone https://github.com/tashfeenahmed/freellmapi.git /app

WORKDIR /app

# Increase body size limit from 1mb to 100mb to handle large LLM context windows
RUN sed -i "s/express.json({ limit: '1mb' })/express.json({ limit: '100mb' })/" server/src/app.ts

RUN npm ci

RUN VITE_BASE=/llmapi/ npm run build

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
