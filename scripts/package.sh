#!/usr/bin/env bash
# Builds dist/supertweet.zip: just what the extension needs. Never includes the private
# config/audience-profiles.json, the server, tests or docs.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist/pkg
cp manifest.json popup.html popup.js options.html options.js dist/pkg/ && cp -R icons dist/pkg/icons && cp -R fonts dist/pkg/fonts
cp -R src dist/pkg/src
mkdir -p dist/pkg/config
for f in config/*.json; do
  case "$(basename "$f")" in audience-profiles.json) ;; *) cp "$f" dist/pkg/config/ ;; esac
done
rm -f dist/pkg/config/audience-profiles.example.json
if find dist/pkg -name 'audience-profiles.json' | grep -q .; then echo "refusing: audience-profiles.json in build" >&2; exit 1; fi
(cd dist/pkg && zip -qr ../supertweet.zip .)
echo "dist/supertweet.zip"; unzip -l dist/supertweet.zip | tail -1
