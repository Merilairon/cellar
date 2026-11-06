#!/bin/sh
# Runs the sidecar image with the hardened flags the compose service (T5) must also use.
# Usage: docker/browser/run.sh [docker run args...] <image> [cmd...]
exec docker run --rm --init \
  --user 10001:10001 \
  --cap-drop ALL --cap-add SYS_CHROOT \
  --security-opt no-new-privileges \
  --security-opt seccomp="$(dirname "$0")/seccomp.json" \
  --read-only --tmpfs /tmp:rw,noexec,size=256m --shm-size 256m \
  --memory 1g --memory-swap 1g --cpus 1 --pids-limit 256 "$@"
