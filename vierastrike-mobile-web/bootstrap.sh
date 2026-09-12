#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -rf app VieraStrike-MVP-ready.zip reconstructed.b64
mkdir -p app
cat parts/part00 parts/part01 parts/part02a parts/part02b parts/part03 parts/part04 parts/part05 > reconstructed.b64
actual_b64_size="$(wc -c < reconstructed.b64 | tr -d ' ')"
[ "$actual_b64_size" = "31288" ] || { echo "Bad base64 size: $actual_b64_size" >&2; exit 1; }
base64 -d reconstructed.b64 > VieraStrike-MVP-ready.zip
actual_size="$(wc -c < VieraStrike-MVP-ready.zip | tr -d ' ')"
[ "$actual_size" = "23465" ] || { echo "Bad ZIP size: $actual_size" >&2; exit 1; }
echo "8372b64c201caeffe36a5f6b2fbbc868d30ac771286cfe9405cdf0252e53ece2  VieraStrike-MVP-ready.zip" | sha256sum -c -
unzip -tq VieraStrike-MVP-ready.zip
unzip -q VieraStrike-MVP-ready.zip -d app
cd app
npm install --omit=dev
npm run check
