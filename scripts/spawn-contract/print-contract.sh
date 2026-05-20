#!/bin/bash
# print-contract.sh — Emit the SPAWN_CONTRACT preamble for a given surface.
# Stable interface for any spawner (on-box tmux glue, cloud-side Cowork glue).
#
# Usage: bash scripts/spawn-contract/print-contract.sh <tmux|cowork>
#
# Resolution order: ~/.claude/coord mirror (on-box) → committed repo copy.
# If neither exists, it tries to build them once via build-spawn-contract.sh.
set -euo pipefail

SURFACE="${1:-}"
case "$SURFACE" in
  tmux|cowork) ;;
  *) echo "usage: $0 <tmux|cowork>" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_SRC="$SCRIPT_DIR"                                   # docs/spawn-contract/
COORD_FILE="$HOME/.claude/coord/spawn-contract.${SURFACE}.txt"
REPO_FILE="$REPO_SRC/SPAWN_CONTRACT.${SURFACE}.txt"

for f in "$COORD_FILE" "$REPO_FILE"; do
  if [ -f "$f" ]; then cat "$f"; exit 0; fi
done

# Neither present — try a one-shot build, then re-resolve.
if [ -x "$SCRIPT_DIR/../build-spawn-contract.sh" ]; then
  bash "$SCRIPT_DIR/../build-spawn-contract.sh" >/dev/null 2>&1 || true
fi
for f in "$COORD_FILE" "$REPO_FILE"; do
  if [ -f "$f" ]; then cat "$f"; exit 0; fi
done

echo "SPAWN_CONTRACT for surface '$SURFACE' not found and could not be generated." >&2
exit 1
