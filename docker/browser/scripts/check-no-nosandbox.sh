#!/bin/sh
# CI gate (threat model section 5, conditions 4 and 5): sandbox-weakening Chromium flags and
# chromiumSandbox:false must not appear anywhere under docker/browser (docs and tests included).
# Also forbids logging request headers, URLs or the token from src/.
cd "$(dirname "$0")/.." || exit 2
if grep -rnE --exclude-dir=node_modules --exclude=check-no-nosandbox.sh \
  -e '--no-sandbox' -e '--disable-setuid-sandbox' -e '--disable-gpu-sandbox' \
  -e 'chromiumSandbox[[:space:]]*:[[:space:]]*false' -e 'NO_SANDBOX' .; then
  echo "FAIL: forbidden sandbox-disabling flag found (see matches above)" >&2
  exit 1
fi
# Logging gate (threat model section 8): never log headers, URLs or the token.
if grep -rnE --include='*.ts' 'console\.[a-z]+\([^)]*(headers|\.url|token)' src; then
  echo "FAIL: src logs request headers, URLs or the token" >&2
  exit 1
fi
echo "ok: no sandbox-disabling flags in docker/browser"
