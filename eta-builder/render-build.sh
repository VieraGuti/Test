#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

GODOT_VERSION="4.6.3"
GODOT_TAG="4.6.3-stable"
GODOT_BASE="https://github.com/godotengine/godot-builds/releases/download/${GODOT_TAG}"

rm -rf work tools dist
mkdir -p work tools dist

echo '=== Fetch ETA ==='
git clone --depth 1 --branch master https://github.com/PiePieDesign/eta-multiplayer.git work/eta
git -C work/eta rev-parse HEAD | tee dist/ETA-UPSTREAM-COMMIT.txt

echo '=== Fetch ETA Git LFS assets ==='
if ! git lfs version; then
  echo 'ERROR: git-lfs is not installed on the builder.' >&2
  exit 1
fi
git -C work/eta lfs install --local
git -C work/eta lfs pull

# Fail early if representative game assets are still Git LFS pointer text.
python3 - <<'PY'
from pathlib import Path
samples = [
    Path('work/eta/Game/props/ammo/ammo.glb'),
    Path('work/eta/Game/weapons/AR15/import/RIG_InfimaGames_TFA_AssaultRifle.fbx'),
]
for p in samples:
    if not p.exists():
        raise SystemExit(f'Missing expected ETA asset: {p}')
    head = p.read_bytes()[:80]
    if head.startswith(b'version https://git-lfs.github.com/spec/v1'):
        raise SystemExit(f'ETA LFS asset was not downloaded: {p}')
    print(f'LFS OK: {p} ({p.stat().st_size} bytes)')
PY

echo '=== Apply VieraStrike private branding / stock engine compatibility ==='
python3 - <<'PY'
from pathlib import Path
root = Path('work/eta/Game')
project = root / 'project.godot'
p = project.read_text(encoding='utf-8-sig')
p = p.replace('config/name="ETA"', 'config/name="VieraStrike"')
p = p.replace('config/version="0.0.1"', 'config/version="0.1.0-private"')
project.write_text(p, encoding='utf-8')

presets = root / 'export_presets.cfg'
e = presets.read_text(encoding='utf-8-sig')
e = e.replace('export_path="../Export/Windows/eta.exe"', 'export_path="../Export/Windows/VieraStrike.exe"')
e = e.replace('application/product_name="ETA"', 'application/product_name="VieraStrike"')
e = e.replace('custom_template/release="../Engine/Templates/windows_release.x86_64.exe"', 'custom_template/release=""')
presets.write_text(e, encoding='utf-8')

# Upstream pins Godot packages to a local patched engine SDK which is intentionally
# not committed. This private build uses official Godot 4.6.3 and a compatibility
# shim for ETA's allocation-free raycast API. Behaviour is preserved; only the
# zero-allocation optimization is lost in this build.
nuget = root / 'NuGet.config'
nuget.write_text('''<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
  </packageSources>
</configuration>
''', encoding='utf-8')

compat_dir = root / 'codebase' / 'compat'
compat_dir.mkdir(parents=True, exist_ok=True)
(compat_dir / 'PhysicsRayQueryResultCompat.cs').write_text(r'''using Godot.Collections;

namespace Godot;

/// <summary>
/// Compatibility holder for ETA's patched-engine PhysicsRayQueryResult3D.
/// The original engine patch avoids Dictionary allocations. This private build
/// preserves the same call-site API while using stock Godot IntersectRay().
/// </summary>
public sealed class PhysicsRayQueryResult3D
{
    private bool _hit;
    private Vector3 _position;
    private Vector3 _normal;
    private int _faceIndex = -1;
    private ulong _colliderId;
    private GodotObject _collider;
    private int _shape;
    private Rid _rid;

    internal void SetFrom(Dictionary hit)
    {
        _hit = hit != null && hit.Count > 0;
        if (!_hit)
        {
            Clear();
            return;
        }

        _position = hit["position"].AsVector3();
        _normal = hit["normal"].AsVector3();
        _faceIndex = (int)hit["face_index"].AsInt64();
        _colliderId = (ulong)hit["collider_id"].AsInt64();
        _collider = hit["collider"].AsGodotObject();
        _shape = (int)hit["shape"].AsInt64();
        _rid = hit["rid"].AsRid();
    }

    internal void Clear()
    {
        _hit = false;
        _position = Vector3.Zero;
        _normal = Vector3.Zero;
        _faceIndex = -1;
        _colliderId = 0;
        _collider = null;
        _shape = 0;
        _rid = default;
    }

    public bool HasHit() => _hit;
    public Vector3 GetPosition() => _position;
    public Vector3 GetNormal() => _normal;
    public int GetFaceIndex() => _faceIndex;
    public ulong GetColliderId() => _colliderId;
    public GodotObject GetCollider() => _collider;
    public int GetShape() => _shape;
    public Rid GetRid() => _rid;
}

/// <summary>Stock-Godot replacement for ETA's patched IntersectRayInto method.</summary>
public static class PhysicsDirectSpaceState3DCompatExtensions
{
    public static bool IntersectRayInto(
        this PhysicsDirectSpaceState3D space,
        PhysicsRayQueryParameters3D parameters,
        PhysicsRayQueryResult3D result)
    {
        Dictionary hit = space.IntersectRay(parameters);
        result.SetFrom(hit);
        return hit.Count > 0;
    }
}
''', encoding='utf-8')
PY

echo '=== Install .NET 8 SDK locally ==='
curl -fsSL https://dot.net/v1/dotnet-install.sh -o tools/dotnet-install.sh
bash tools/dotnet-install.sh --channel 8.0 --install-dir "$HERE/tools/dotnet" --no-path
export DOTNET_ROOT="$HERE/tools/dotnet"
export PATH="$DOTNET_ROOT:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
dotnet --version

echo '=== Download Godot 4.6.3 Mono Linux editor ==='
curl -fL --retry 5 --retry-delay 5 \
  -o tools/godot-editor.zip \
  "$GODOT_BASE/Godot_v${GODOT_TAG}_mono_linux_x86_64.zip"
mkdir -p tools/godot-editor
python3 - <<'PY'
import zipfile
with zipfile.ZipFile('tools/godot-editor.zip') as z:
    z.extractall('tools/godot-editor')
PY
GODOT_EXE="$(find tools/godot-editor -type f -name 'Godot*mono*linux*x86_64*' ! -name '*.zip' | head -n 1)"
if [ -z "$GODOT_EXE" ]; then
  echo 'Godot Mono Linux editor was not found after extraction.' >&2
  find tools/godot-editor -maxdepth 3 -type f | head -n 100
  exit 1
fi
chmod +x "$GODOT_EXE"
"$GODOT_EXE" --version

echo '=== Download Godot Mono export templates ==='
curl -fL --retry 5 --retry-delay 5 \
  -o tools/godot-templates.tpz \
  "$GODOT_BASE/Godot_v${GODOT_TAG}_mono_export_templates.tpz"
mkdir -p tools/templates-unpacked
python3 - <<'PY'
import zipfile
with zipfile.ZipFile('tools/godot-templates.tpz') as z:
    z.extractall('tools/templates-unpacked')
PY
TEMPLATE_SRC="$HERE/tools/templates-unpacked/templates"
TEMPLATE_DST="$HOME/.local/share/godot/export_templates/4.6.3.stable.mono"
if [ ! -d "$TEMPLATE_SRC" ]; then
  echo 'Mono export template directory missing.' >&2
  find tools/templates-unpacked -maxdepth 2 -type d
  exit 1
fi
mkdir -p "$TEMPLATE_DST"
cp -a "$TEMPLATE_SRC/." "$TEMPLATE_DST/"

echo '=== Restore and compile ETA C# against official Godot 4.6.3 SDK ==='
dotnet restore work/eta/Game/keta.csproj --configfile work/eta/Game/NuGet.config
dotnet build work/eta/Game/keta.csproj -c Release -nologo --no-restore

echo '=== Import Godot project ==='
"$GODOT_EXE" --headless --path work/eta/Game --editor --quit-after 30

echo '=== Export VieraStrike Windows ==='
mkdir -p work/export
"$GODOT_EXE" --headless --path work/eta/Game --export-release Windows "$HERE/work/export/VieraStrike.exe"

if [ ! -f work/export/VieraStrike.exe ]; then
  echo 'VieraStrike.exe was not generated.' >&2
  find work/export -maxdepth 3 -type f -print
  exit 1
fi

cat > work/export/client.cmd <<'EOF'
@echo off
"%~dp0VieraStrike.exe" %*
EOF

cat > work/export/server.cmd <<'EOF'
@echo off
"%~dp0VieraStrike.exe" --headless -- --server --max-players 10 --bots 10 --gamemode competitive --host 0.0.0.0 --port 27015
pause
EOF

cat > work/export/join-server.cmd <<'EOF'
@echo off
set /p VS_HOST=Server IP or hostname: 
"%~dp0VieraStrike.exe" -- --connect %VS_HOST%:27015
EOF

cat > work/export/PRIVATE-USE-NOTICE.txt <<'EOF'
VieraStrike private friends-only test build based on ETA.
FREE / NO MONETIZATION.
Do not sell access, skins, battle passes, items, or other content while ETA restricted assets are present.
ETA source-code license notices remain applicable.
EOF

cp dist/ETA-UPSTREAM-COMMIT.txt work/export/ETA-UPSTREAM-COMMIT.txt
cp work/eta/LICENSE.md work/export/ETA-LICENSE.md

python3 - <<'PY'
from pathlib import Path
import shutil
src = Path('work/export')
out = Path('dist/VieraStrike-ETA-Windows-private')
shutil.make_archive(str(out), 'zip', src)
print(Path(str(out)+'.zip').stat().st_size)
PY

rm -rf work tools

echo '=== VieraStrike build ready ==='
ls -lh dist/
