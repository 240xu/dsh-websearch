# dsh-websearch v2.0 Extension Plan

## Current State (v1.0) - Completed

| Backend | Type | Key | Endpoint | Status |
|---|---|---|---|---|
| Exa | MCP (streamable-http) | 无 | mcp.exa.ai/mcp | Done |
| Parallel | MCP (streamable-http) | 无 | search.parallel.ai/mcp | Done |
| DuckDuckGo | HTML scrape | 无 | html.duckduckgo.com | Done |
| DeepSeek | Anthropic Messages + web_search tool | DEEPSEEK_API_KEY | api.deepseek.com/anthropic/v1 | Done |
| Anthropic | Anthropic Messages + web_search_20250305 | ANTHROPIC_API_KEY | api.anthropic.com/v1 | Done |
| OpenAI | Responses API + web_search tool | OPENAI_API_KEY | api.openai.com/v1/responses | Done |

**Architecture**: Single provider id "unified" registers to ctx.web, internal Promise.allSettled fan-out -> URL dedup merge. Settings namespace unified-search manages enabledBackends, numResults, baseURL/model/credential-ref.

---

## Candidate New Platforms - Priority Tiers

### Tier 1: High value, generous free tier, easy integration (Strongly recommended for v2.0)

| Platform | Auth | Free Tier | Integration | Advantage |
|---|---|---|---|---|
| Brave Search | API Key | 2,000/mo | REST /res/v1/web/search | Independent index, no Google bias, high quality |
| Tavily | API Key | 1,000/mo | REST /search | AI-focused, returns answer + results[], optional deep search |
| Serper.dev | API Key | 2,500/mo | REST /search | Scrapes Google, structured organic[], very fast |
| SearXNG | None/Self-hosted | Unlimited | REST /search?q= | Metasearch, can point to public instances, privacy-friendly |
| Mojeek | API Key | 1,000/day | REST /v1/search | Independent index, no tracking, English-focused |

### Tier 2: Specialized, paid/small quota, optional (v2.1 or on-demand)

| Platform | Auth | Free Tier | Integration | Note |
|---|---|---|---|---|
| Google CSE | API Key + CX | 100/day | REST /customsearch/v1 | Official Google, need Custom Search Engine |
| You.com | API Key | Has free | REST /search | AI search, optional recency |
| Jina AI | None | Unlimited | https://s.jina.ai/http://... | Actually summarizer, can do search+summarize pipeline |
| Firecrawl | API Key | Has free | REST /v1/search | Search+scrape unified, good for deep research |

### Tier 3: MCP protocol based (like Exa/Parallel pattern)

| Platform | MCP Endpoint | Status |
|---|---|---|
| Exa | mcp.exa.ai/mcp | Done |
| Parallel | search.parallel.ai/mcp | Done |
| Brave MCP | (TBD) | Research |
| Tavily MCP | (TBD) | Research |

---

## Settings UI Integration - Plugin Button in Built-in Settings

### Current State
- installSettingsSection(ctx, "unified-search", Config, ...) already registers in settings
- User must write YAML in cordis.patch.yml or settings.yaml manually
- searchProvider: "unified" specified in web config

### Goal: Native appearance in DSH Web GUI Settings Panel

DSH Web GUI Settings Panel reads all namespaces from ctx.settings and auto-renders forms from schema. To make unified-search appear natively:

1. Namespace naming: unified-search already matches ^[a-z][a-z0-9-]*$
2. Schema completeness: Current Config has enabledBackends[], numResults, per-backend baseURL/model/credential-ref
3. Secret field marking: credentialRef + z.string().role("credential-ref") correctly marked, GUI renders as password input

Missing GUI-friendly fields (recommend adding to v2.0 Config):

backendConfigs: z.array(z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  label: z.string(),
  description: z.string(),
  type: z.enum(["keyless", "credential", "mcp"]),
  requiresKey: z.boolean(),
  keyEnvVar: z.string().optional(),
  baseURL: z.string().optional(),
  model: z.string().optional(),
})).optional(),

defaultNumResults: z.number().min(1).max(50).default(8),
concurrency: z.number().min(1).max(10).default(6),
backendTimeoutMs: z.number().min(1000).max(120000).default(30000),

GUI Rendering Effect:
- Unified Search section appears in Settings sidebar
- Table columns: Enabled | Name | Type | API Key (password) | Base URL | Model
- Each row draggable for priority order
- Bottom: Global results count, concurrency, timeout

---

## Implementation Roadmap

### Phase 1: Backend Expansion (v2.0.0) - 2-3 days
1. Add 5 Tier 1 backend files: lib/backends/brave.js, tavily.js, serper.js, searxng.js, mojeek.js
2. Unified BackendConfig interface, BACKENDS registry auto-scan
3. Update Config schema with backendConfigs, global concurrency/timeout
4. Unit tests for new backend parsers

### Phase 2: Settings GUI Polish (v2.0.1) - 1 day
1. Config add label, description, type, requiresKey GUI metadata fields
2. Verify installSettingsSection auto-renders in Web GUI Settings panel
3. Add credential-ref runtime resolution hints

### Phase 3: MCP Backend Unified Abstraction (v2.1.0) - 1 day
1. Abstract McpSearchBackend base class: handles initialize -> notifications/initialized -> tools/call handshake, session cache, SSE/JSON dual parsing
2. Migrate Exa/Parallel to base class, new MCP backends only need toolName, toolArgsBuilder, parser config

### Phase 4: Advanced Features (v2.2.0) - Optional
- Dedup strategy options: URL / title similarity / embedding vectors
- Region/language/time filters (depends on backend support)
- Search depth: fast / standard / deep (Tavily/Perplexity support)
- Result scoring/reranking (optional ruflo/embeddings integration)

---

## Code Structure Changes

lib/
  backends/
    brave.js          # NEW
    tavily.js         # NEW
    serper.js         # NEW
    searxng.js        # NEW
    mojeek.js         # NEW
    exa.js            # Existing -> migrate to McpSearchBackend
    parallel.js       # Existing -> migrate to McpSearchBackend
    ddg.js            # Existing
    anthropic-like.js # Existing
    openai.js         # Existing
    index.js          # NEW: unified export, auto-registration, type defs
  provider.js         # Tweak: read backendConfigs for dynamic enable
  index.js            # Config schema extend, resolveOptions enhance
  util/
    mcp-client.js     # NEW: MCP handshake reuse
    abort.js
    rpc.js
    log.js
tests/
  parse.test.js       # Extend new parser tests
  provider.test.js    # Extend fan-out tests

---

## Credential Management - Button in Built-in Settings

DSH credentials service (ctx.credentials) stores secrets separately; settings only store credentialRef. GUI behavior:
1. Settings panel shows DeepSeek API Key input (role=secret), user fills in
2. Click save -> calls credentials.set(ref, value) to encrypted storage
3. Subsequent searches resolveApiKey() auto-reads from credentials
4. Env var DEEPSEEK_API_KEY as fallback

No extra code needed - dsh-settings + dsh-credentials fully support this. Just declare credentialRef fields correctly in Config.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Too many concurrent calls hit rate limits | concurrency config + p-limit control, exponential backoff retry |
| New backend parsers brittle | Per-backend test files, real API integration test CI |
| MCP handshake instability | mcp-client.js unified retry, session invalidation auto-rebuild, 10min TTL |
| Settings GUI doesnt render array of objects | z.array(z.object(...)) + installSettingsSection already supports nested object arrays |

---

## Deliverables Checklist

- 5 new backend files + unit tests
- Config schema extension + GUI metadata
- MCP client reuse module
- README bilingual update (new backend table, config examples)
- examples/cordis.patch.yml update
- CHANGELOG v2.0.0
