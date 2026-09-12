#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -rf app
mkdir -p app
unzip -q VieraStrike-MVP-ready.zip -d app
cd app
npm install --omit=dev
npm run check
