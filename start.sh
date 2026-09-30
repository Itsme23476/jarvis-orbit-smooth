#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -t 0 ] && [ ! -f .jarvis.local.json ]; then
  python3 -m agent.setup
fi
exec python3 -m agent.main
