#!/usr/bin/env bash
# Package a Jev Lens release: tag must equal manifest.json's version, and the
# release must attach main.js, manifest.json, styles.css (Obsidian convention).
#
# Usage: scripts/release.sh <version>   e.g. scripts/release.sh 0.2.1

set -euo pipefail
V="${1:?Usage: release.sh <version-matching-manifest.json>}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

INSTALLED="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
[[ "$INSTALLED" == "$V" ]] || { echo "FAIL: manifest.json version is $INSTALLED, not $V"; exit 1; }
python3 -c "import json;assert '$V' in json.load(open('versions.json')), 'add {\"$V\": <minAppVersion>} to versions.json'"

git tag "$V"
git push origin "$V"
gh release create "$V" main.js manifest.json styles.css \
  --title "$V" \
  --generate-notes
echo "released $V — installable via BRAT (JoseEchave/obsidian-jev-lens)"
