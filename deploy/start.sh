#!/usr/bin/env bash
# Thin wrapper — the actual launcher is cross-platform Node (works on
# Linux/macOS/Windows): node deploy/start.mjs
exec node "$(dirname "$0")/start.mjs" "$@"
