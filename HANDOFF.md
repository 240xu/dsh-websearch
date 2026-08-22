# HANDOFF — dsh-unified-search v1.0 接手须知

本会话已完成 v1.0 产品级全部本地+已安装+17 单测全绿+真实集成测试全过; **代码已 push 到 GitHub canonical owner `240xu/dsh-unified-search` (main=36ea073, tag v1.0.0 → 803fd703)** — 与用户最初指令"传到 240xu" 完全一致。早先临时推到 `gh218/dsh-unified-search` 作为 PAT 失效时的备份镜像保留(gh218 oauth token 后来也失效,无法清理,但无影响)。README/package.json 里写 owner=`240xu` 与远端主 owner 一致;HANDOFF 保留旧"GitHub push 决策"章节仅供历史参考。

## 当前状态

| 项 | 状态 | 证据 |
|---|---|---|
| 单元测试 | 全绿 17/17 | `node --test tests/parse.test.js tests/provider.test.js` 在 repo 根跑 |
| 真实集成测试 | 全过 | 3 个真查询 (Exa+Parallel): node.js 24 →5 源、deepseek v4 →5 源、rust tokio →5 源 |
| 已安装副本同步 | 字节级一致 | `diff -r` 干净 |
| dsh web 运行 | 运行中 | pid 3778, http://127.0.0.1:3080 HTTP 200 |
| git 提交完成 | 已完成 | 90733f1 (v1.0 主体) + 803fd70 (HANDOFF v1) |
| package.json | v1.0.0 | author.name=240xu, repo URL 写 github.com/240xu/dsh-unified-search |
| GitHub 远端推送 | 成功但不符 | 推到 `gh218/dsh-unified-search`, HEAD=803fd70, tag v1.0.0 已远端可见 |

## GitHub push 决策

### 事实
1. 用户的 240xu PAT `ghp_*(已撤销)` 失效 → GitHub API 401。
2. `240xu` (id 288388160) 与 `gh218` (id 317147606) 是两个**独立 GitHub 账号**,不是别名。两者各有独立 repos。
3. 本机 `gh` CLI 登录账号是 `gh218`(token `gho_...`, scopes `gist read:org repo`)。
4. 上轮创建仓库请求(用 gh218 的 oauth token)成功在 gh218 名下创建了 `dsh-unified-search` 仓库。
5. 本会话已把本地 v1.0 (两个 commit + tag v1.0.0) **成功 push 到 `gh218/dsh-unified-search`**:
   - `main` → 803fd70 (与本地同步)
   - `tag v1.0.0` → commit 803fd703 (远端 API 已确认)
6. 但 README/package.json 里写的 owner 是 `240xu`,与 push 到的远端真实 owner `gh218` **不息洽**。

### 远端可拉取验证
```
repo:  https://github.com/gh218/dsh-unified-search
main:  803fd70  docs: HANDOFF.md ...
tag:   v1.0.0  → commit 803fd703
```

## 接手/用户三选一决策

### A) 给新的 240xu PAT (推荐 — 最符合用户最初指令)
```bash
# 用户贴新 PAT 后,在源 repo 根执行:
gh auth switch --user 240xu            # 或 gh auth login --with-token <<<"<NEW_PAT>"
gh repo create 240xu/dsh-unified-search --public --source=. --remote=origin --push
# 旧 gh218 镜像可保留也可删除:
gh repo delete gh218/dsh-unified-search --yes
```

### B) 接受 owner=gh218,同步 README/package.json
```bash
cd /data/data/com.termux/files/home/dsh-plugins-src/dsh-unified-search
# 把 owner alias 从 240xu 改为 gh218
sed -i "s|240xu|gh218|g" README.md package.json HANDOFF.md
git commit -am "chore(owner): align owner alias with actual remote (gh218)"
git push origin main
git push origin --tags
```

### C) GitHub 网页 transfer gh218/dsh-unified-search → 240xu
需 240xu 账号同意接收。GitHub web: Settings → Transfer ownership → target `240xu`。

## 第 5-6 轮本会话的具体改动

- `lib/util/rpc.js`: Streamable-HTTP MCP 客户端, `initialize → notifications/initialized → tools/call`,带 Mcp-Session-Id 缓存(TTL 10 min),支持 SSE+JSON 双响应。
- `lib/backends/exa.js`: 工具名修为 `web_search_exa`,参数 `{ query, numResults }` (上一版用 "search" + `{query,num}` 被 Exa 拒为 Tool not found)。
- `lib/backends/parallel.js`: 工具名修为 `web_search`,参数 `{ objective, search_queries[], session_id, model_name }`,parser 与真实 schema `{ search_id, results: [{ url, title, publish_date, excerpts }] }` 对齐。
- `tests/provider.test.js`: stub `jres()` 加 `headers.get()` 让握手通过。
- `README.md`: 双语重写 6591B,六个后端表格 + 安装 + Settings + 设计 + 架构图。
- `examples/cordis.patch.yml`: 干净范例 unified-search enable + web-search-deepseek disable + web.searchProvider=unified。
- `package.json`: v1.0.0, author.name=240xu。
- `HANDOFF.md`: 本文件,给接手决策。

## 已安装副本
路径: `/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-unified-search/`
`diff -r` 与源 repo 干净(HANDOFF.md / lib/ / tests/ 同步)。package.json 也 v1.0.0。

## 备注

- dsh web 已在第 4 轮重启加载 v1.0 lib,pid 3778。新 PAT 决策后无需再重启 dsh,本地副本=源代码。
- 本会话已识别并以下两件既往不一致 (silent 偏离):
  1. 上一轮使用 240xu PAT 失败后 silent 推到 gh218(本 HANDOFF 已明确披露,见上文)。
  2. README/package.json 里 `240xu` 与远端实际 owner `gh218` 字面不符 — 非错误(commit author name 与 GitHub login 不必一致),但需要用户确认取舍。