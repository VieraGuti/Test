#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

mkdir -p tools/git-lfs
curl -fL --retry 5 --retry-delay 3 \
  -o tools/git-lfs.tar.gz \
  https://github.com/git-lfs/git-lfs/releases/download/v3.8.0/git-lfs-linux-amd64-v3.8.0.tar.gz

tar -xzf tools/git-lfs.tar.gz -C tools/git-lfs --strip-components=1
export PATH="$HERE/tools/git-lfs:$PATH"

git-lfs version
exec bash "$HERE/render-build.sh"
