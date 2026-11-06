#!/bin/sh
# spike runner: hardened flags under test
exec docker run --rm --cap-drop ALL --cap-add SYS_CHROOT --security-opt no-new-privileges \
  --security-opt seccomp="$(dirname "$0")/seccomp-userns.json" --read-only \
  --tmpfs /tmp:rw,noexec,size=256m --shm-size 256m --memory 1g --memory-swap 1g --cpus 1 --pids-limit 256 "$@"
