# HANDOFF — dsh-unified-search v1.0 接手须知

本文件给下一个接手本任务的 agent / 模型阅读。本会话(原模型)把 product-grade v1.0 的所有本地工件做完并就绪,只差 **GitHub 远程 push 这一步**——该步因 PAT 凭证失效而无法由本会话自行完成。

## 当前状态(本会话结束时)

| 项 | 状态 | 证据 |
|---|---|---|
| 单元测试 | ✅ 17/17 全绿 | `node --test tests/parse.test.js tests/provider.test.js` 在 repo 根目录跑(pass=17 fail=0) |
| 真实集成测试 | ✅ 全过 | live-test 跑过 3 个真查询;"latest node.js 24 release notes" 4152ms→5 源, "deepseek v4" 1905ms→5 源, "rust tokio" 2528ms→5 源 (Exa+Parallel 都拿到准确结果) |
| 已安装副本同步 | ✅ 字节级一致 | `diff -r` 输出对源 repo 与 `…/dsh/node_modules/@deepseek-ai/dsh-unified-search/` 双向干净 |
| dsh web 运行中 | ✅ | pid 在(http://127.0.0.1:3080 返回 200) |
| git 已 commit v1.0 | ✅ | commit `90733f1`(main),summary "v1.0: unified fan-out provider ..." |
| package.json v1.0.0 | ✅ | owner=240xu, repo=git+https://github.com/240xu/dsh-unified-search.git |
| README 双语 | ✅ | 6591 字节,讲清六个后端 + 安装 + Settings + 设计 |

## 剩余阻塞:GitHub 仓库上传

**只能由人类或新 PAT 解决,接手模型自己无法绕过**

1. 用户最初指定的 PAT `ghp_REDACTED_ROTATE_ME` 已失效 (`GET /user` 返回 401)。
2. 当前 `gh` CLI 登录的账号是 `gh218`(另一个 GitHub 账户,scopes 含 repo),**不是用户要的 `240xu`**。若用它创建,push 上去 owner 会是 `gh218`,与 README / package.json 的 `240xu` 不一致,违反用户指令。

## 接手模型该怎么做

1. 询问用户提供**新的 `240xu` PAT**(GitHub personal access token,scopes 含 repo / repo:status)。把它贴到这里就能继续。
2. 或者用户明确同意改 owner 到 `gh218`,则需同时把 `README.md` 与 `package.json` 里所有 `240xu` 改成 `gh218` 后再 push。
3. 不要"迫降 push 到其它随便一个账户"——这违反用户明确指令("以后项目就传到这上面",指 240xu)、是 silent 妥协。

## 接手模型可直接接手的工作流

预 push 流程:

```bash
cd /data/data/com.termux/files/home/dsh-plugins-src/dsh-unified-search
# 1. 重新跑测试确认仍绿:
node --test tests/parse.test.js tests/provider.test.js
# 2. 确认最近 1 次 commit:
git log --oneline -1   # 应是 90733f1 ... v1.0
# 3. 拿到新的 240xu PAT 之后替换 remote 的 PAT (推荐用 git credential helper):
gh auth login    # 按提示切到 240xu,填新 PAT
# 或:
git remote remove origin
git remote add origin https://240xu:<NEW_PAT>@github.com/240xu/dsh-unified-search.git
# 4. 创建仓库并 push:
gh repo create 240xu/dsh-unified-search --public --source=. --remote=origin --push
# 或:
curl -H "Authorization: token <NEW_PAT>" -X POST https://api.github.com/user/repos \
  -d '{"name":"dsh-unified-search","private":false}'
git push -u origin main
git tag v1.0.0
git push origin v1.0.0
```

## Hub 备注

- 已安装副本位置: `/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-unified-search/`
- 已安装副本的 package.json 也已 bump 到 1.0.0,owner=240xu,repo URL 同步。
- 如果接手模型跑 live-test,记得把那个 .mjs 临时文件放仓库里(其 `node_modules/@deepseek-ai/*` 是 symlink,符号需要正确指 `…/dsh/node_modules/@deepseek-ai/<pkg>`,不要双重嵌套)。不要把 live-test.mjs 提交到 git。
- cordis.patch.yml 用的范例代码在 `examples/cordis.patch.yml`。主机当前生效的 `~/.dsh/profiles/web/cordis.patch.yml` 已含 unified-search 块,web-search-deepseek disabled,无 mcp-unified-search stub。
- 重启 dsh web 已经完成一 次(pid 3778)。新 PAT 后 push 完不需要重启 dsh;插件不会从远端拉,本地副本就是源代码。
