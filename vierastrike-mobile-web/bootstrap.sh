#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -rf app VieraStrike-MVP-ready.zip
mkdir -p app
base64 -d VieraStrike-MVP-ready.zip.b64 > VieraStrike-MVP-ready.zip
unzip -q VieraStrike-MVP-ready.zip -d app
cd app
npm install --omit=dev
npm run check
