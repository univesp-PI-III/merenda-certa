FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src
COPY scripts ./scripts

ENV PORT=3000
ENV MQTT_PORT=1883
ENV MQTT_HOST=0.0.0.0

EXPOSE 3000 1883

CMD ["npm", "start"]
