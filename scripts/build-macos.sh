#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Cleaning previous build artifacts..."
rm -rf src-tauri/target/release/bundle/dmg/*
rm -rf src-tauri/target/release/bundle/macos/*

echo "==> Building Tauri macOS app..."
pnpm tauri build 2>&1 | tail -10

DMG="src-tauri/target/release/bundle/dmg/Terax_0.8.0_aarch64.dmg"
echo "==> DMG size: $(ls -lh "$DMG" | awk '{print $5}')"

echo "==> Installing to /Applications..."
hdiutil attach "$DMG" -nobrowse
cp -R /Volumes/Terax/Terax.app /Applications/
hdiutil detach /Volumes/Terax

echo "==> Launching DMG in Finder..."
open "$DMG"

echo "==> Done."
