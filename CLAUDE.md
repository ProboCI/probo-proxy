# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

probo-proxy is an HTTP reverse proxy for ProboCI that routes incoming requests to the correct build container. It resolves a "destination identifier" from each request (via subdomain or query parameter), performs a lookup against a container manager service to find the target container's host/port, and proxies the request through.

## Commands

- **Start:** `npm start` (or `node index.js -c <config.yaml>`)
- **Dev mode:** `npm run startdev` (requires nodemon and bunyan globally)
- **Run all tests:** `npm test`
- **Watch tests:** `npm run testw`
- **Lint:** `npx eslint .` (uses eslint-config-probo)
- **Build Docker image:** `./build.sh <repository_name> <tag>`

## Architecture

**Request flow:** Incoming HTTP request → `lib/proxy.js` (setupServer) → `lib/utils.js` (extract and parse destination identifier from subdomain or `?proboDest=`/`?proboBuildId=` query param) → `lib/proxy-lookup.js` (POST to container lookup service to resolve build container host/port, with LRU caching) → optional basic auth check → `http-proxy` forwards request to container → `lib/proxy-rewrite.js` (rewrites Host header based on build config's `sites` mapping before proxying).

**Key modules:**
- `index.js` — Entry point. Loads config, creates server, sets timeout.
- `lib/proxy.js` — HTTP server creation and main request handler. Wires together lookup, auth, and proxying.
- `lib/proxy-lookup.js` — Resolves destination to container host/port via HTTP POST to `containerLookupHost` + `/container/proxy`. Results are cached in an LRU cache when `cacheEnabled` is true.
- `lib/proxy-rewrite.js` — `proxyReq` event handler that sets the Host header based on the build config's `sites` map and the destination's site modifier.
- `lib/utils.js` — Parses destination identifiers. Format: `IDENTIFIER[--pr-N|--br-NAME][--site-NAME]` where `--` is the modifier separator.
- `lib/config.js` — YAML config loading via `yaml-config-loader`. Merges `defaults.yaml` → env vars → CLI `-c` config files → CLI args.
- `lib/logger.js` — Bunyan logger singleton.

**Configuration layering:** `defaults.yaml` is the base, environment variables are normalized and overlaid, then any YAML files passed via `-c` flag, then CLI args. The key config values are `port`, `hostname`, `containerLookupHost`, `cacheEnabled`, `cacheMax`, `cacheMaxAge`, `redirectUrl`, and `custom404Html`. Local development config goes in `proxy.yaml` (gitignored).

**Destination identifier format:** `BUILDID`, `PROJECTID--pr-N`, `PROJECTID--br-BRANCH`, any of which can have `--site-SITENAME` appended. Parsed in `lib/utils.js:parseDest`.

## Testing

Tests use mocha with `should` assertions and `co-mocha` for generator-based async tests. Network calls are mocked with nock using recorded fixtures in `test/fixtures/`. The `test/__setup.js` file silences logging and sets `CONTAINER_LOOKUP_HOST` to a nocked endpoint. The `test/__nockout.js` helper loads and manages nock fixtures with support for PLAY/RECORD modes.

## Docker

Runs on Node 22 (node:22-slim). Container exposes port 3050 and reads config from `/etc/probo/proxy.yaml` at startup via `bin/startup.sh`.
