FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY src/Chart.Renderer/package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/.cache && chown -R node:node /app
COPY src/Chart.Renderer/server.cjs ./
COPY src/Chart.Worker/wwwroot/echarts-adapter.js ./
USER 1000:1000
EXPOSE 8091
CMD ["node","server.cjs"]
