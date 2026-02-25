#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose up --build -d

echo "Merenda Certa app: http://localhost"
echo "MQTT broker: mqtt://localhost:1883"
echo "Use 'docker compose logs -f app mqtt-sim' to follow logs."
