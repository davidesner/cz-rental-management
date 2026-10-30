#!/bin/bash
# Builds the upload zips of agent-plugin/ into plugin-dist/ (not committed):
#   rental-management-claude.zip   claude.ai / Claude Desktop upload  (.claude-plugin + .mcp.json + skills + commands)
#   rental-management-chatgpt.zip  ChatGPT desktop / Codex upload     (.codex-plugin + .mcp.json + skills)
#
#   ./scripts/build-plugin.sh                      -> connector of agent-plugin/.mcp.json (main deployment)
#   ./scripts/build-plugin.sh https://<your-app>   -> connector pointing at a self-hosted deployment
#
# The marketplaces (.claude-plugin/marketplace.json, .agents/plugins/marketplace.json) install
# agent-plugin/ directly; this script is only for manual uploads.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/agent-plugin"
OUT="$ROOT/plugin-dist"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

node "$ROOT/scripts/check-plugin-version.mjs"

cp -R "$SRC/." "$STAGE/"
find "$STAGE" \( -name .DS_Store -o -name __pycache__ -o -name '*.pyc' \) -prune -exec rm -rf {} +

if [ -n "${1:-}" ]; then
  BASE="${1%/}"
  [[ "$BASE" =~ ^https://[^/?#]+$ ]] || { echo "base URL must be an https origin, e.g. https://rental.example.com"; exit 2; }
  python3 - "$STAGE/.mcp.json" "$BASE/mcp" <<'PY'
import json, sys
path, url = sys.argv[1:]
data = json.load(open(path))
data["mcpServers"]["rental-management"]["url"] = url
json.dump(data, open(path, "w"), indent=2)
open(path, "a").write("\n")
PY
fi

mkdir -p "$OUT"
rm -f "$OUT/rental-management-claude.zip" "$OUT/rental-management-chatgpt.zip"
(cd "$STAGE" && zip -qr "$OUT/rental-management-claude.zip" .claude-plugin .mcp.json skills commands README.md CHANGELOG.md)
(cd "$STAGE" && zip -qr "$OUT/rental-management-chatgpt.zip" .codex-plugin .mcp.json skills README.md CHANGELOG.md)
echo "connector: $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["mcpServers"]["rental-management"]["url"])' "$STAGE/.mcp.json")"
echo "plugin-dist/rental-management-claude.zip, plugin-dist/rental-management-chatgpt.zip"
