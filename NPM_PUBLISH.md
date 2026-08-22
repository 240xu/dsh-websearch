# npm 发布步骤（需要你的 npm 账号，机器上无登录态）

## 前置：包名已迁移为可发布的无 scope 名

- package.json name: `dsh-websearch`（npm 上可用，已验证 404 = 未被占用）
- 所有引用（bundle patch / client id / profile 依赖 / 文档）已同步

## 发布（在源仓库目录执行）

```bash
cd /data/data/com.termux/files/home/dsh-plugins-src/dsh-websearch

# 1. 登录 npm（浏览器 OTP 流程，或用 automation token）
npm login                      # 走 https://www.npmjs.com/login
# 或: npm config set //registry.npmjs.org/:_authToken=<YOUR_NPM_TOKEN>

# 2. 注意本机 .npmrc 默认指向 npmmirror（国内镜像），发布必须走官方源：
npm publish --registry=https://registry.npmjs.org --access public

# 3. 验证
npm view dsh-websearch version
```

发布后市场会自动识别（awesome-dsh-plugin 的爬虫读取 npm downloads），PR #2679 合并后
install 命令可从 `dsh plugin add github:240xu/dsh-websearch` 升级为
`dsh plugin add dsh-websearch`。

## npx 直装（可选）

npx 主要用于可执行包。本插件是库+bundle，不适用 npx 安装；
正确的安装方式就是上面两条（git 或 npm）。
