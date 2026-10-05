# Telegram bot image (works on Railway / Render / Fly / any Docker host). Build context: ./bot
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
# Webhook mode listens on $PORT (default 3001); GET /healthz returns 200. Polling mode needs no port.
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "if(process.env.BOT_MODE!=='webhook')process.exit(0);require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]
