#!/bin/bash
# Installs npm dependencies at the start of Claude Code cloud sessions so
# typecheck, lint and tests work immediately. No-op on local machines.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# npm ci installs exactly what package-lock.json pins and never rewrites it
# (npm install would churn the lockfile under a different npm version). Skip it
# when node_modules already matches the current lockfile, e.g. a cached container.
STAMP=node_modules/.claude-lock-hash
LOCK_HASH=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$LOCK_HASH" ]; then
  echo "session-start: dependencies already match package-lock.json" >&2
  exit 0
fi

npm ci --no-audit --no-fund --loglevel=error >&2
echo "$LOCK_HASH" > "$STAMP"
