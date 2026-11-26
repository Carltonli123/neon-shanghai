#!/usr/bin/env bash
# Downloads three.js r170 (MIT) and the add-ons the game uses into public/vendor/three,
# following relative imports so every dependency is present. Run from the project root.
set -euo pipefail
VER=0.170.0
BASE="https://cdn.jsdelivr.net/npm/three@${VER}"
DEST="public/vendor/three"
queue=(
  build/three.module.js
  examples/jsm/controls/OrbitControls.js
  examples/jsm/postprocessing/EffectComposer.js
  examples/jsm/postprocessing/RenderPass.js
  examples/jsm/postprocessing/OutputPass.js
  examples/jsm/postprocessing/UnrealBloomPass.js
  examples/jsm/postprocessing/SMAAPass.js
  examples/jsm/postprocessing/GTAOPass.js
  examples/jsm/postprocessing/BokehPass.js
  examples/jsm/postprocessing/ShaderPass.js
  examples/jsm/objects/Reflector.js
  examples/jsm/utils/BufferGeometryUtils.js
)
seen=" "   # bash 3.2 (macOS) has no associative arrays
count=0
mkdir -p "$DEST"
curl -fsSL "$BASE/LICENSE" -o "$DEST/LICENSE"
while [ ${#queue[@]} -gt 0 ]; do
  f="${queue[0]}"; queue=("${queue[@]:1}")
  case "$seen" in *" $f "*) continue;; esac
  seen="$seen$f "; count=$((count+1))
  mkdir -p "$DEST/$(dirname "$f")"
  curl -fsSL "$BASE/$f" -o "$DEST/$f"
  dir=$(dirname "$f")
  while IFS= read -r imp; do
    [ -z "$imp" ] && continue
    p=$(node -e "console.log(require('path').posix.normalize(process.argv[1]+'/'+process.argv[2]))" "$dir" "$imp")
    queue+=("$p")
  done < <(grep -oE "(from|import) +'\.{1,2}/[^']+'" "$DEST/$f" | sed -E "s/^(from|import) +'(.*)'$/\2/" | sort -u)
done
echo "Downloaded $count files to $DEST"
