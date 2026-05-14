FROM node:20-alpine

RUN apk add --no-cache git python3 make g++

RUN git clone https://github.com/tashfeenahmed/freellmapi.git /app

WORKDIR /app

RUN npm ci

RUN npm run build

EXPOSE 3001

CMD ["node", "server/dist/index.js"]
