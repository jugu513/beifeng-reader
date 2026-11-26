# 工具链

`tool/` 里全是只读检查和构建脚本，没有第三方依赖，用 `node` 直接跑。它们不进成品，只服务于开发和验收。

> 路径约定：本文命令假设你在 `dev/` 目录下运行（`cd dev`）；在仓库根运行则写成 `node dev/tool/…`。

## 从哪开始

```bash
node tool/selfcheck.mjs          # 交付前完整检查
node tool/selfcheck.mjs --quick  # 日常自查，秒级
```

`selfcheck` 是唯一入口：它先从 `src/` 构建母本、同步六份副本，再依次跑 11 道闸门和 12 项报告，最后给出能不能交付的结论。日常改完代码直接跑它就行。

## 构建

| 脚本 | 作用 |
|---|---|
| `build.mjs` | 读 `src/`，替换占位符，拼成单文件，写到根目录的母本 txt |
| `deploy.mjs` | 把母本同步到另外五份副本 |
| `build-check.mjs` | 从 src 构建到临时文件，和母本逐字节比对 |

改代码的正确顺序：编辑 `src/` → `node tool/build.mjs` → `node tool/deploy.mjs`。或者直接跑 `selfcheck`，前两步它会自动做。

## 闸门

| 脚本 | 查什么 |
|---|---|
| `gate-v2.mjs` | 19 道结构判据 |
| `acceptance.mjs` | 静态验收与红线 |
| `dup-scan.mjs` | 重复定义 |
| `src-gate.mjs` / `layer-gate.mjs` | src 结构与分层清单 |
| `parity-gate.mjs --strict` | 同一事实多处声明是否一致 |
| `regress-gate.mjs` | 汇总 11 套行为回归 |
| `ledger.mjs` | 改动记录，支持单项回退预演 |

## 报告

`fact-check` / `dead-fn` / `empty-catch` / `scan-comments` / `comment-facts` / `aa-skins` / `ui-copy-flags` / `ui-strings` / `copy-audit` / `copy-consistency` / `undeclared-assign` / `polish-audit` 这 12 项只出数，不阻断交付。红项提示人工复核。

## 浏览器验证

```bash
node tool/serve.mjs 8791   # 起本地服务
```

然后用浏览器打开 `http://127.0.0.1:8791`。`verify-full.mjs` 和 `verify-*.mjs` 是一组真机验证脚本，通过 CDP 驱动 Chromium，检查外观、后端、撤销、API 等，要求零 pageerror。没有 Chromium 时会显式跳过。

真机验证必须走 `http://127.0.0.1`，不能用 `file://`——后者是不透明源，IndexedDB 会被浏览器禁用，测出来的结果是假的。

## 一条纪律

新增检查必须先证明它能红：先在修复前的快照上跑出失败，再在修复后归零，最后注入一个真问题确认它还会红。只绿不红的检查等于没检查。
