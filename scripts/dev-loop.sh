#!/usr/bin/env bash
# Jev Lens — automated dev/test loop via the official Obsidian CLI.
#
# Requires:
#   - Obsidian 1.12+ with the CLI enabled (Settings → General →
#     Command line interface)
#   - If your `obsidian` wrapper injects extra Electron flags (e.g. Arch
#     user-flags.conf), the CLI parser will choke on them — see README.
#
# Usage:
#   ./dev-loop.sh /path/to/vault            # full smoke test
#   ./dev-loop.sh /path/to/vault reload     # reload the plugin only
#
# Env overrides:
#   PLUGIN_ID (default jev-lens)
#   NOTE_NAME (default: the lens note's file name)

set -uo pipefail

PLUGIN_ID="${PLUGIN_ID:-jev-lens}"
VAULT="${1:?Usage: dev-loop.sh /path/to/vault [reload]}"
MODE="${2:-full}"
NOTE_NAME="${NOTE_NAME:-Lenses.md}"
SHOT="${SHOT:-/tmp/${PLUGIN_ID}-test.png}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OBSIDIAN_BIN="${OBSIDIAN_BIN:-$(command -v obsidian || echo /usr/bin/obsidian)}"

cd "$VAULT" || exit 1   # cwd targets this vault in the CLI
ob() { "$OBSIDIAN_BIN" "$@"; }

echo "== 0. Static checks (no GUI needed) =="
node --check "$REPO_DIR/main.js" || { echo "FAIL: syntax error"; exit 1; }
node "$REPO_DIR/scripts/test.js" >/dev/null || { echo "FAIL: offline tests"; exit 1; }
echo "OK"

ob help >/dev/null 2>&1
if ! ob eval code="1" >/dev/null 2>&1; then
  echo "waiting for the Obsidian app to start..."
  ok=0
  for _ in $(seq 1 40); do
    if ob eval code="1" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  [[ $ok -eq 1 ]] || { echo "FAIL: Obsidian app did not respond to CLI"; exit 1; }
fi

if [[ "$MODE" == "reload" ]]; then
  echo "== reload only =="
  ob plugin:reload id="$PLUGIN_ID"
  exit $?
fi

echo "== 1. Ensure plugin is enabled and reload it =="
ob eval code="app.plugins.enablePlugin('$PLUGIN_ID').then(() => 'enabled')" >/dev/null
ob plugin:reload id="$PLUGIN_ID" || { echo "FAIL: plugin:reload"; exit 1; }

echo "== 2. Assert plugin object exists =="
LOADED=$(ob eval code="!!app.plugins.plugins['$PLUGIN_ID']")
echo "loaded: $LOADED"
[[ "$LOADED" == *"true"* ]] || { echo "FAIL: plugin not loaded"; ob devtools; exit 1; }

echo "== 3. Open a note and force an evaluation =="
ob eval code="app.workspace.openLinkText('$NOTE_NAME', '', false).then(() => 'opened')" >/dev/null
sleep 2
ob eval code="app.commands.executeCommandById('$PLUGIN_ID:evaluate-now'); 'triggered'" >/dev/null
echo "waiting for API round-trip..."
sleep 12

echo "== 4. Assert tab indicator + status bar + tooltip wiring =="
STATE=$(ob eval code="JSON.stringify((() => { const h = [...document.querySelectorAll('.workspace-tab-header')].find(x => x.querySelector('.jev-dot')); return {dot: !!h, dotText: h?.querySelector('.jev-dot')?.textContent?.trim() ?? null, status: document.querySelector('.jev-status')?.textContent ?? null, ariaLabel: h?.getAttribute('aria-label')?.slice(0, 40) ?? null}; })())")
echo "state: $STATE"
[[ "$STATE" == *'"dot":true'* ]] || { echo "FAIL: no .jev-dot in tab title"; exit 1; }
[[ "$STATE" == *'ariaLabel":"Jev'* ]] || { echo "FAIL: no aria-label on tab (tooltip would not appear)"; exit 1; }

echo "== 5. Screenshot for visual check =="
ob dev:screenshot path="$SHOT" && echo "screenshot: $SHOT"

echo "== PASS =="
