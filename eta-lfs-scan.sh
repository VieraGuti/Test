#!/usr/bin/env bash
set -u
rm -rf /tmp/git-lfs* /tmp/eta
curl -fsSL -o /tmp/git-lfs.tar.gz https://github.com/git-lfs/git-lfs/releases/download/v3.6.1/git-lfs-linux-amd64-v3.6.1.tar.gz || exit 10
tar -xzf /tmp/git-lfs.tar.gz -C /tmp || exit 11
LFSBIN="$(find /tmp -type f -name git-lfs | head -1)"
chmod +x "$LFSBIN"
echo "git-lfs=$($LFSBIN version)"
for REPO in Mayur88888888/eta-multiplayer ArtcadeDev/eta-multiplayer vcheckk/eta-multiplayer lawrior/eta-multiplayer PiePieDesign/eta-multiplayer; do
  echo "===== TEST $REPO ====="
  rm -rf /tmp/eta
  if ! GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 "https://github.com/$REPO.git" /tmp/eta; then
    echo "CLONE_FAILED"
    continue
  fi
  cd /tmp/eta || continue
  "$LFSBIN" install --local >/dev/null 2>&1 || true
  "$LFSBIN" pull --include="Game/maps/dust/de_dust2.tscn" --exclude=""
  RC=$?
  echo "LFS_RC=$RC"
  if [ -f Game/maps/dust/de_dust2.tscn ]; then
    BYTES="$(wc -c < Game/maps/dust/de_dust2.tscn | tr -d ' ')"
    echo "MAP_BYTES=$BYTES"
    if [ "$BYTES" -gt 1000000 ]; then
      echo "REAL_MAP_FOUND=$REPO"
    else
      echo "POINTER_ONLY=$REPO"
      cat Game/maps/dust/de_dust2.tscn || true
    fi
  else
    echo "MAP_MISSING"
  fi
  cd / || true
done
echo SCAN_DONE
exit 0
