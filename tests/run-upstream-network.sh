#!/usr/bin/env bash
# v21 and provider stub globalThis.fetch, but this tree routes every request
# through egressFetch, which honours HTTP_PROXY/HTTPS_PROXY itself — under the
# ambient proxy the stubs never see the call. They are named .network.js so the
# default `node --test tests/*.test.js` glob skips them; run them here.
set -euo pipefail
cd "$(dirname "$0")/.."
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  -u NODE_USE_ENV_PROXY -u NO_PROXY -u no_proxy \
  node --test tests/up-v21.network.js tests/up-provider.network.js
