# Browser sidecar (v0.3.2, optional)

A small HTTP service that renders a JS-only recipe page in headless Chromium and returns the DOM. Off by default; the app only uses it when `HEADLESS_URL` is set. T2 delivers the image, the HTTP layer and the sandbox self-check. Request filtering (T3) and the render lifecycle (T4) are not built yet: `POST /render` currently fails closed with `503 {"error":"failed"}`.

## API

| Route          | Notes                                                                                                                                                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz` | No token. 200 only after the sandbox self-check passed.                                                                                                                                                                                                                                                     |
| `POST /render` | `Authorization: Bearer <HEADLESS_TOKEN>` (constant-time compare, header only, never the query string). `Content-Type: application/json`, body max 2 KB, fields `url` and optional `waitMs` only. 400 bad JSON or fields, 401 bad token (no work done), 413 oversize, 415 wrong type, 503 busy or not ready. |

Anything else is 404 (path) or 405 (method).

## Environment

`PORT` (3001), `BIND_ADDR` (0.0.0.0, set to the internal interface address if you can), `HEADLESS_TOKEN` (required, 32+ hex or base64 characters; the sidecar refuses to start without it unless `HEADLESS_ALLOW_NO_TOKEN=1`, which is logged; never passed to Chromium), `RENDER_TIMEOUT_MS` (default and **hard max 30000**, larger values are clamped), `MAX_CONCURRENT_RENDERS` (1), `MAX_TOTAL_BYTES` (15 MB), `MAX_SUB_REQUESTS` (150), `MAX_REDIRECTS` (5). No other variable is read. Never put `SESSION_SECRET` or a DB path here.

## Sandbox (threat model section 5)

Chromium runs with its own sandbox, always. The sandbox-weakening flags are forbidden everywhere in this directory (`scripts/check-no-nosandbox.sh`, a CI gate), and `launchBrowser` rejects them at runtime. At start the server runs a self-check: not uid 0, Chromium launches, and a renderer lives in its own user namespace. If any check fails the process exits with a `FATAL` line and never listens. Hosts with `user.max_user_namespaces=0` are unsupported and say so in that line. A platform that cannot run the sandbox is unsupported, not run unsandboxed.

Required runtime settings (use `run.sh`, the T5 compose service must match): user `10001`, `--cap-drop ALL --cap-add SYS_CHROOT` (exactly that one capability), `no-new-privileges`, `--security-opt seccomp=docker/browser/seccomp.json`, read-only root, tmpfs `/tmp` (noexec), `--shm-size 256m`, memory/pids limits.

### seccomp.json

`seccomp.json` is the Docker default profile plus one unconditional rule allowing `clone, clone3, unshare, setns`, and nothing else. The base is `moby/profiles` tag `seccomp/v0.3.0`, `seccomp/default.json` (what Docker 29.x embeds), sha256 `6416b47770785a41ac59073cdc77d9fe98517df2799dc83ef207e622de3053f6`, kept as `seccomp.base.json` (do not reformat it; it is in `.prettierignore`). Reproduce the proof:

```sh
node docker/browser/scripts/check-seccomp.mjs --fetch   # re-download the pinned base, verify hash, compare
node docker/browser/scripts/check-seccomp.mjs           # same, using the committed base (offline)
diff <(jq -S . docker/browser/seccomp.base.json) <(jq -S . docker/browser/seccomp.json)
```

Adding any further syscall needs a new security review. To update the base, change the tag and hash in the script, re-fetch, re-diff, re-test.

## Build and test

```sh
docker build -t cellar-browser docker/browser     # pinned base digest, playwright-core 1.64.1 via npm ci
docker/browser/run.sh -p 127.0.0.1:3001:3001 -e HEADLESS_TOKEN=... cellar-browser
npm run test:browser                              # from the repo root: grep gate, seccomp diff, node:test
```

`playwright-core` is pinned to the same version as `@playwright/test` in the app. Keep them equal when upgrading.
