FROM node:22-bookworm-slim
WORKDIR /app
COPY services/runtime/package.json services/runtime/package.json
RUN cd services/runtime && npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY core ./core
COPY server ./server
COPY services/runtime ./services/runtime
RUN find core server services/runtime -path '*/node_modules' -prune -o -name '*.ts' -exec node --experimental-strip-types --check {} \; && node --experimental-strip-types --test services/runtime/smoke.test.ts
ENV NODE_ENV=production
USER node
EXPOSE 10000
CMD ["node","--experimental-strip-types","services/runtime/supervisor.ts"]