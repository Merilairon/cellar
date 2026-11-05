#!/usr/bin/env bash
# Regenerate Playwright visual baselines in the same image CI uses, so fonts match.
# Run from the repo root. Keep the image tag equal to the @playwright/test version.
set -euo pipefail
tmp="$(mktemp -d)"
git clone -q . "$tmp/repo"
docker run --rm --ipc=host -v "$tmp/repo:/work" -w /work mcr.microsoft.com/playwright:v1.64.1-noble bash -c '
  apt-get update && apt-get install -y build-essential python3
  npm i -g n && n "$(cut -d. -f1 .nvmrc)" && hash -r
  npm ci && CI=1 npx playwright test --update-snapshots'
cp "$tmp"/repo/tests/e2e/__screenshots__/recipes-visual.spec.ts/*.png tests/e2e/__screenshots__/recipes-visual.spec.ts/
rm -rf "$tmp"
