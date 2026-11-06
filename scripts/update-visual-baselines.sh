#!/usr/bin/env bash
# Regenerate Playwright visual baselines in the same image CI uses, so fonts match.
# Run from the repo root. Keep the image tag equal to the @playwright/test version.
#
# The container runs as root, so everything it writes into the clone is root-owned and a host
# `rm -rf` would fail and leave /tmp/tmp.* behind. The container therefore hands ownership back
# to the calling user (HOST_UID/HOST_GID) on exit, and a trap removes the clone on any exit.
# One-time: stale /tmp/tmp.* dirs from earlier runs of this script need `sudo rm -rf` (not automated).
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone -q . "$tmp/repo"
docker run --rm --ipc=host -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$tmp/repo:/work" -w /work mcr.microsoft.com/playwright:v1.64.1-noble bash -c '
  trap "chown -R \"$HOST_UID:$HOST_GID\" /work" EXIT
  apt-get update && apt-get install -y build-essential python3
  npm i -g n && n "$(cut -d. -f1 .nvmrc)" && hash -r
  npm ci && CI=1 npx playwright test --update-snapshots'
cp -r "$tmp"/repo/tests/e2e/__screenshots__/. tests/e2e/__screenshots__/
