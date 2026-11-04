#!/usr/bin/env bash
# Builds the Windows installer + portable exe from Linux.
# The NSIS step needs a full (32-bit capable) Wine, so electron-builder runs in its
# official Docker image. Output lands in dist/, owned by you.
set -euo pipefail
cd "$(dirname "$0")/.."

npx electron-vite build

mkdir -p "$HOME/.cache/electron" "$HOME/.cache/electron-builder"
docker run --rm \
  -v "$PWD":/project \
  -v "$HOME/.cache/electron":/root/.cache/electron \
  -v "$HOME/.cache/electron-builder":/root/.cache/electron-builder \
  -w /project \
  electronuserland/builder:wine \
  /bin/bash -c 'npx electron-builder --win --x64; s=$?; chown -R '"$(id -u):$(id -g)"' dist; exit $s'

ls -lh dist/*.exe
