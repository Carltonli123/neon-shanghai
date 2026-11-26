#!/usr/bin/env bash
# Downloads OpenStreetMap data (© OpenStreetMap contributors, ODbL) for each district
# from the public Overpass API into data-raw/. Then run: node tools/osm-build.js
set -euo pipefail
mkdir -p data-raw
fetch() {
  local name="$1" bbox="$2"
  local q="[out:json][timeout:180];
(
  way[\"building\"](${bbox});
  relation[\"building\"](${bbox});
  way[\"highway\"](${bbox});
  way[\"natural\"=\"water\"](${bbox});
  relation[\"natural\"=\"water\"](${bbox});
  way[\"waterway\"=\"riverbank\"](${bbox});
  relation[\"waterway\"=\"riverbank\"](${bbox});
  way[\"leisure\"~\"^(park|garden|pitch)$\"](${bbox});
  relation[\"leisure\"~\"^(park|garden)$\"](${bbox});
  way[\"landuse\"~\"^(grass|recreation_ground|village_green)$\"](${bbox});
  way[\"place\"=\"square\"](${bbox});
  way[\"area:highway\"](${bbox});
);
out geom;"
  echo "Fetching $name ($bbox)..."
  local ok=0
  for attempt in 1 2 3; do
    for ep in https://overpass-api.de/api/interpreter https://overpass.kumi.systems/api/interpreter; do
      if curl -fsS --max-time 240 -A "neon-huangpu-dev/0.2" --data-urlencode "data=${q}" "$ep" -o "data-raw/${name}.json"; then
        ok=1; echo "  from $ep"; break 2
      fi
      echo "  $ep failed (attempt $attempt), retrying..."; sleep 8
    done
  done
  [ "$ok" = 1 ] || { echo "Could not download $name"; exit 1; }
  ls -lh "data-raw/${name}.json"
}
fetch ljz "31.2235,121.4790,31.2525,121.5230"
sleep 5
fetch psq "31.2195,121.4585,31.2425,121.4895"
