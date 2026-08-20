# dsh-unified-search v2.0 Extension - Implementation Plan

**Created**: $(date -I)
**Feature**: Add 5 new search backends (Brave, Tavily, Serper, SearXNG, Mojeek) + Settings GUI integration + MCP abstraction

---

## Phase 1: Backend Expansion (v2.0.0) - 5 New Backends

### Task 1.1: Create Brave Search Backend
**File**: `lib/backends/brave.js`
**Spec**: 
- REST API: `GET https://api.search.brave.com/res/v1/web/search?q={query}&count={count}`
- Auth: `X-Subscription-Token: {apiKey}` header
- Response: `{ web: { results: [{ url, title, description, age }] } }`
- Free tier: 2,000 requests/month
- Keyless: false (requires API key)

**Parser**: Extract `url`, `title`, `description` (snippet), `age` (publishedAt)
**Config**: `baseURL`, `apiKeyEnv` (default: `BRAVE_API_KEY`)

**Test**: `tests/parse.test.js` - add parser test cases

---

### Task 1.2: Create Tavily Backend
**File**: `lib/backends/tavily.js`
**Spec**:
- REST API: `POST https://api.tavily.com/search` with JSON body
- Auth: `Authorization: Bearer {apiKey}` or `api_key` in body
- Body: `{ query, max_results, search_depth: "basic|advanced", include_answer: true }`
- Response: `{ answer, results: [{ url, title, content, score }] }`
- Free tier: 1,000 requests/month
- Keyless: false

**Parser**: Use `answer` as optional snippet, `results[]` for sources
**Config**: `baseURL`, `apiKeyEnv` (default: `TAVILY_API_KEY`), `searchDepth` (default: "basic")

**Test**: Add parser test cases

---

### Task 1.3: Create Serper.dev Backend
**File**: `lib/backends/serper.js`
**Spec**:
- REST API: `POST https://google.serper.dev/search`
- Auth: `X-API-KEY: {apiKey}` header
- Body: `{ q: query, num: count }`
- Response: `{ organic: [{ link, title, snippet, position }], ... }`
- Free tier: 2,500 requests/month
- Keyless: false

**Parser**: Extract `organic[]` -> `url`, `title`, `snippet`
**Config**: `baseURL`, `apiKeyEnv` (default: `SERPER_API_KEY`)

**Test**: Add parser test cases

---

### Task 1.4: Create SearXNG Backend
**File**: `lib/backends/searxng.js`
**Spec**:
- REST API: `GET {baseURL}/search?q={query}&format=json&categories=general&language=en&safesearch=1`
- Auth: None (public instances) or API key if self-hosted
- Response: `{ results: [{ url, title, content, engine, score }] }`
- Free tier: Unlimited (public instances)
- Keyless: true (optional key for private instances)

**Parser**: Extract `results[]` -> `url`, `title`, `content` (snippet)
**Config**: `baseURL` (default: `https://searx.be`), `apiKeyEnv` (optional)

**Test**: Add parser test cases

---

### Task 1.5: Create Mojeek Backend
**File**: `lib/backends/mojeek.js`
**Spec**:
- REST API: `GET https://api.mojeek.com/v1/search?q={query}&fmt=json&count={count}`
- Auth: `Authorization: Bearer {apiKey}` header (or query param `api_key=`)
- Response: `{ response: { results: [{ url, title, desc, last_updated }] } }`
- Free tier: 1,000/day
- Keyless: false

**Parser**: Extract `response.results[]` -> `url`, `title`, `desc` (snippet), `last_updated` (publishedAt)
**Config**: `baseURL`, `apiKeyEnv` (default: `MOJEEK_API_KEY`)

**Test**: Add parser test cases

---

### Task 1.6: Create Unified Backend Registry
**File**: `lib/backends/index.js`
**Purpose**: Single export point, auto-registration, type definitions
**Exports**: `BACKENDS` object, `ALL_BACKEND_IDS` array, `BackendConfig` interface

---

### Task 1.7: Extend Config Schema & resolveOptions
**File**: `lib/index.js`
**Changes**:
1. Add `backendConfigs` array schema with GUI metadata
2. Add `concurrency`, `backendTimeoutMs` global settings
3. Update `resolveOptions` to read `backendConfigs` and merge with defaults
4. Add new backend credential refs: `braveApiKeyEnv`, `tavilyApiKeyEnv`, `serperApiKeyEnv`, `mojeekApiKeyEnv`
5. Add new backend baseURL/model defaults

---

### Task 1.8: Extend Provider Fan-out Logic
**File**: `lib/provider.js`
**Changes**:
1. Read `backendConfigs` to determine enabled backends (instead of just `enabledBackends` array)
2. Apply `concurrency` limit using `p-limit` or similar
3. Apply `backendTimeoutMs` per-backend
4. Maintain existing URL dedup + merge logic

---

## Phase 2: Settings GUI Polish (v2.0.1)

### Task 2.1: Verify Settings Panel Auto-Renders
**Action**: Start `dsh web`, open Settings panel, verify "Unified Search" section appears with:
- Table: Enabled | Name | Type | API Key | Base URL | Model
- Draggable rows for priority
- Global settings at bottom

### Task 2.2: Add GUI Metadata to Each Backend Config
**File**: `lib/index.js` - `backendConfigs` schema
**Fields**: `label`, `description`, `type`, `requiresKey`

---

## Phase 3: MCP Backend Abstraction (v2.1.0)

### Task 3.1: Create MCP Client Utility
**File**: `lib/util/mcp-client.js`
**Features**:
- `initialize → notifications/initialized → tools/call` handshake
- Session cache with TTL (10 min)
- SSE + JSON dual parsing
- Auto-rebuild on 401/403/404
- Exports: `mcpCall(url, toolName, args, signal)`, `invalidateSession(url)`

### Task 3.2: Migrate Exa & Parallel to McpSearchBackend Base
**Files**: `lib/backends/exa.js`, `lib/backends/parallel.js`
**Base Class**: `McpSearchBackend` with config: `toolName`, `toolArgsBuilder(request, options)`, `parser(result, maxResults)`

---

## Testing Requirements

### Unit Tests (tests/parse.test.js)
- [ ] Brave parser: happy path, missing fields, empty results
- [ ] Tavily parser: with/without answer, deep search results
- [ ] Serper parser: organic results, missing snippet
- [ ] SearXNG parser: multiple engines, empty results
- [ ] Mojeek parser: desc field, last_updated parsing

### Integration Tests (tests/provider.test.js)
- [ ] All 11 backends fan-out (mocked)
- [ ] Concurrency limit respected
- [ ] Backend timeout handled
- [ ] URL dedup across all backends
- [ ] Keyless backends work without keys
- [ ] Key-gated backends skip when no key

---

## Documentation Updates

- [ ] README.md: Add 5 new backends to table, update config examples
- [ ] examples/cordis.patch.yml: Add new backend env var examples
- [ ] CHANGELOG.md: v2.0.0 entry

---

## Acceptance Criteria

1. `node --test tests/parse.test.js tests/provider.test.js` → all pass
2. `dsh web` starts, Settings panel shows "Unified Search" with 11 backends
3. Live search with all keyless backends (Exa, Parallel, DDG, SearXNG) returns results
4. Key-gated backends (Brave, Tavily, Serper, Mojeek, DeepSeek, Anthropic, OpenAI) activate when key provided
5. Concurrency limit and timeout respected
6. URL dedup works across all 11 backends
