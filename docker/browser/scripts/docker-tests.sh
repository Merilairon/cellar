#!/bin/sh
# Runs the three real-Chromium test files inside an already built sidecar image with the hardened
# flags of run.sh at --memory 2g (the abuse suite OOMs at 1g, see docs/tasks/v0.3.2-carryover.md).
# Usage: docker/browser/scripts/docker-tests.sh <image> [platform]
set -eu
image="$1"
platform="${2:-}"
root="$(cd "$(dirname "$0")/../../.." && pwd)"
status=0
for f in render render-abuse syscalls; do
  echo "== $f.docker.test.ts ${platform:+($platform)}"
  # shellcheck disable=SC2086
  "$root/docker/browser/run.sh" ${platform:+--platform "$platform"} --memory 2g --memory-swap 2g \
    -v "$root/docker/browser/test:/srv/test:ro" -e BROWSER_DOCKER_TESTS=1 -e HEADLESS_ALLOW_NO_TOKEN=1 \
    --entrypoint node "$image" --test "test/$f.docker.test.ts" || status=1
done
exit $status
