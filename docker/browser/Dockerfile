# Headless-browser sidecar (v0.3.2, optional, compose profile "headless").
# Build context: docker/browser. Multi-arch (linux/amd64, linux/arm64; arm64 is verified by
# the CI QEMU job, not claimed until that job is green).
#
# Base pinned by tag AND digest (multi-arch index digest, resolved 2026-11-06):
#   node:24-bookworm-slim = sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
# To upgrade: resolve the new digest (docker buildx imagetools inspect), edit both lines,
# rebuild and re-run the sandbox tests (docs/tasks/v0.3.2-threat-model.md section 5).
FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9

# Browsers are downloaded at build time only, into a fixed path readable by pwuser.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /srv

# One runtime dependency (playwright-core, exact version, lockfile). Chromium headless shell only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
 && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 npx --no-install playwright-core install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm \
 && useradd --no-create-home --uid 10001 --shell /usr/sbin/nologin pwuser

COPY src ./src

USER 10001:10001
EXPOSE 3001

# Exec form: no shell is needed at run time.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "src/healthcheck.ts"]

CMD ["node", "src/server.ts"]
