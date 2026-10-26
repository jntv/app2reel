#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"

if command -v node >/dev/null 2>&1; then
  CAPTURE_NODE_BIN="$(command -v node)"
elif [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  CAPTURE_NODE_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
else
  print 'Install Node.js 22 or newer, then follow README.md.'
  exit 1
fi
export PATH="${CAPTURE_NODE_BIN:h}:$PATH"
if [[ ! -f node_modules/tsx/dist/cli.mjs ]]; then
  print 'Install dependencies first: npm install && npm run setup'
  print 'See README.md for the complete setup.'
  exit 1
fi
print 'App2Reel starts at http://127.0.0.1:4310 (unless PORT is set).'
print 'Keep this window open while using the studio. Press Control-C to stop.'
exec "$CAPTURE_NODE_BIN" node_modules/tsx/dist/cli.mjs server/index.ts --production
