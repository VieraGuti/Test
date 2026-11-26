FROM mcr.microsoft.com/playwright:v1.51.1-noble
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN npm install --no-audit --no-fund playwright@1.51.1
COPY worker.cjs /app/worker.cjs
ENV NODE_ENV=production
CMD ["node","worker.cjs"]
