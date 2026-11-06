# SPIKE (S0) scratch image. Becomes T2 if the spike passes.
FROM node:24-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /srv
RUN npm init -y >/dev/null && npm install --save-exact playwright-core@1.64.1 \
 && npx playwright-core install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 10001 pwuser && chown -R pwuser /srv
COPY spike.mjs /srv/spike.mjs
USER pwuser
CMD ["node","spike.mjs"]
