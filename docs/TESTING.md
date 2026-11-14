# QuickDesk 测试计划（发布前必须全部通过）

本文件定义 QuickDesk 的测试分层、覆盖矩阵、发布门禁和手工验收清单。
原则：**任何代码修改或版本发布，都必须先有对应测试，`npm test` 全绿后才能发布。**

## 1. 发布门禁

| 环节 | 门禁 |
|---|---|
| 本地修改后 | `npm test` 全部通过 |
| `npm publish` | `prepublishOnly` 自动运行 `node scripts/test-all.mjs`，失败即中止发布 |
| GitHub CI | `npm ci` → 语法检查 → `npm test` → `npm pack --dry-run`，全绿才能合并 |
| GitHub Release | 打 `v*` tag 后 release workflow 先跑 `npm test`，通过才 npm publish / 建 Release；Release 正文必须来自双语的 `docs/release-notes/<version>.md` |
| 手工验收 | 每个 release 必须在至少一台**中文代码页（GB2312/936）Windows** 和一台 UTF-8 系统上按第 6 节验收 |

`npm test` 目前包含 9 个套件（见 `scripts/test-all.mjs`）：

1. `scripts/selftest.mjs` — 44 项离线单元检查
2. `scripts/verify-release.mjs` — 发布元数据检查
3. `scripts/tests/encoding.test.mjs` — **所有 .ps1/.cmd 必须纯 ASCII**
4. `scripts/tests/powershell-syntax.test.mjs` — PowerShell 5.1 解析 + GB2312 读取模拟
5. `scripts/tests/module.test.mjs` — 配置、语言、协议、预算、locale 契约
6. `scripts/tests/release-notes.test.mjs` — **每个版本必须有中英双语 Release 说明**
7. `scripts/tests/diagnostics.test.mjs` — 诊断脚本生成 zip、内容完整、临时目录清理
8. `scripts/tests/package.test.mjs` — manifest、版本一致性、npm pack 内容
9. `scripts/tests/launcher-runtime.test.mjs` — 隐藏 sidecar 启动/热键/注册/重启/互斥

## 2. 测试分层

### L0 静态 / 发布门禁（每次提交）
- 全部 `.ps1`/`.cmd` 纯 ASCII，禁止非 ASCII 字节（防止 GB2312 系统解析失败）；
- PowerShell AST 解析无错误，并在 GB2312 读取模拟下仍解析通过；
- `.mjs` / `client.js` 语法检查（`node --check`）；
- `package.json` 身份、license、os、engines、publishConfig、dsh.bundle/client；
- 版本在 `package.json`、`package-lock.json`、`CHANGELOG.md` 三处一致；
- `files[]` 覆盖所有运行文件，且不包含测试/诊断/压缩包；
- `npm pack --dry-run` 内容正确；
- README 安装命令、收录徽章、首屏平台/后端要求；
- locale 中英文键集合一致；
- 仓库中不含本地绝对路径/隐私信息。

### L1 单元（纯函数 / 配置）
- `readConfig` 默认值、非法值回填、数值范围；
- volatile `{get()}` 解包；
- `resolveLanguage` 显式/auto；
- `renderPrompt` 内置协议、`{{MAX_STEPS}}` 替换；
- `displayKey` 归一化；
- `budgetExceeded` 边界（等于上限、超出、关闭强制）；
- locale meta/ui/prompt 完整性；
- Config schema 的 18 个字段与顺序；
- 客户端字典 zh/en 键一致（selftest 已覆盖）。

### L2 Launcher（PowerShell 原生层）
- 参数默认值（Hotkey/StatusCorner/SubmitKey/CancelKey/UI 文本）；
- `RegisterHotKey` 注册成功 / 失败路径；
- 低层键盘钩子安装；
- 数字键（`Ctrl+Shift+0`）、F 键、组合键解析；
- 隐藏窗口启动后输出 `ready` 并保持存活；
- `quit` 命令退出、宿主式"quit 后立即重启"拿锁；
- 第二实例在互斥锁被占用时干净退出（code 0，不输出 ready）；
- `launcher.log` 创建与关键日志行；
- stdin EOF 行为观察（当前会存活，存在孤儿锁风险，后续修复需加退出/看门狗）。

### L3 Host 集成（Node 层，当前部分手工）
- 插件模块可被 Node import（`plugin-import`，DSH 自带 node）；
- `apply()` 能创建 sidecar，参数与配置一致；
- settings watcher 500ms 轮询 committed config 后：
  - 改 hotkey/submitKey/cancelKey/statusCorner → sidecar 重启并生效；
  - 改其他字段 → 不重启 sidecar，后续任务读取新值；
- `tools/pre-execute` 步数预算触发 `agent.cancel`；
- 审批弹窗接管 `approval/request`；
- 桌面后端缺失时不提交任务并提示；
- 任务提交成功后 HUD 显示运行/完成/停止。
> 现状：L3 中 `apply()` 与 watcher 需要 mock DSH ctx 才能自动化，列为下一阶段（见第 7 节）；发布前用第 6 节手工替代。

### L4 安装 / 升级 / 市场
- `npm pack` 后干净目录 `npm install dsh-quickdesk@<version>` 成功；
- `dsh plugin --profile quickdesk-test add dsh-quickdesk` 成功，文件齐全；
- DSH 启动加载无报错（`quickdesk.mjs` import OK、settings 页面可保存）；
- 升级覆盖安装后旧 sidecar 不残留；
- 卸载后 sidecar 退出、热键注销；
- 市场收录页、README 安装命令、主题 `dsh-plugin` 存在。

### L5 手工 E2E（发布前必须执行）
见第 6 节。

## 3. 覆盖矩阵（风险 → 测试）

| 风险 | 自动化测试 | 手工测试 |
|---|---|---|
| 中文 Windows GB2312 下 .ps1 解析失败（本次 bug） | encoding、powershell-syntax（GB2312 模拟） | 第 6.1 节 |
| 快捷键解析/注册（数字、F 键、组合） | launcher-runtime（Ctrl+Shift+0） | 6.2 |
| sidecar 不启动 / 无日志 | launcher-runtime（日志断言） | 6.1/6.2 |
| quit 后立即重启被互斥锁卡死 | launcher-runtime（restart） | 6.3 |
| 多实例互斥 | launcher-runtime（mutex） | 6.4 |
| stdin EOF 孤儿 sidecar | 观察项（待修复） | 6.4 |
| 设置页保存后热键不生效 | L3（待自动化） | 6.3 |
| 设置页保存了错误字段/通用页 | package/module（部分）+ 手工 | 6.3 |
| 任务完成后模型继续截图/总结 | selftest（预算）+ 手工任务 | 6.5 |
| 审批弹窗按键/超时 | 手工 | 6.6 |
| 中英文文案缺失/不一致 | selftest、module | 6.7 |
| npm 包装错文件/漏文件 | package | 6.8 |
| 诊断报告保存位置/临时目录清理 | diagnostics | 6.9 |
| 双语 Release 说明缺失 | release-notes | - |
| 版本号/tag/CHANGELOG 不一致 | package、release workflow | - |
| README 市场要求/隐私路径 | verify-release | - |

## 4. 命令

```powershell
npm test                 # 全部套件（发布门禁）
npm run test:unit        # selftest 44 项
npm run test:release     # 发布元数据检查
npm test -- --list       # 当前不支持；直接看 scripts/test-all.mjs
```

单套件调试：

```powershell
node scripts/tests/encoding.test.mjs
node scripts/tests/powershell-syntax.test.mjs
node scripts/tests/module.test.mjs
node scripts/tests/release-notes.test.mjs
node scripts/tests/diagnostics.test.mjs
node scripts/tests/package.test.mjs
node scripts/tests/launcher-runtime.test.mjs
```

## 5. 测试数据 / 隔离

- Launcher runtime 测试使用**临时复制的 launcher.ps1**，替换互斥锁名和日志目录（每个用例唯一），因此可与真实 QuickDesk sidecar 并存，不会抢真实热键；
- 测试使用 F19/F20/Ctrl+Shift+0 等不常用组合；真实配置 `Ctrl+0` / `Ctrl+Alt+Space` 不会被注册；
- 每个用例结束强制 kill 子进程并删除临时日志目录；
- 非 Windows 平台自动 SKIP PowerShell 相关套件（CI 使用 windows-latest，不会跳过）。

## 6. 手工 E2E 验收清单

至少准备两台机器：
- **A：中文 Windows 10 19041 默认 GB2312 代码页**（本次问题机器）；
- **B：UTF-8 系统 / Windows 11 开发机**。

对每个候选版本（如 1.2.1）：

### 6.1 安装与首次启动
- [ ] 干净安装 `dsh plugin --profile desktop add dsh-quickdesk@<version>`；
- [ ] 完全退出并重启 DSH；
- [ ] 检查 `%LOCALAPPDATA%\dsh-quickdesk\launcher.log` 存在，且含 `start pid=`、`RegisterHotKey registered=True`、`low-level hook installed=True`；
- [ ] 任务管理器中有且仅有一个 `powershell.exe ... launcher.ps1`；
- [ ] 设置 → QuickDesk 显示**自定义设置页**（不是通用字段列表）；
- [ ] 按默认热键弹出输入框。

### 6.2 快捷键矩阵
- [ ] `Ctrl+Alt+Space` 弹框；
- [ ] `Ctrl+0` 弹框（本次问题键）；
- [ ] `Ctrl+Shift+0` 弹框；
- [ ] 改 `Ctrl+Alt+F9` 保存后立即生效；
- [ ] 改回默认保存后立即生效；
- [ ] 输入框内 Enter 提交、Esc 关闭；
- [ ] 提交键/取消键改为其它组合后生效。

### 6.3 设置实时生效
- [ ] 改语言 zh/en，输入框/状态条/协议文案切换；
- [ ] 改状态条位置/开关，HUD 变化；
- [ ] 改 maxSteps，超限取消本轮（HUD 显示停止原因）；
- [ ] 改 approvalPopup 开关，审批弹窗行为变化；
- [ ] **连续快速改 hotkey 5 次**，最终仅 1 个 sidecar 且热键为最后一次的值；
- [ ] 修改后重启 DSH，设置仍保留（profile patch 持久化）。

### 6.4 生命周期 / 多实例
- [ ] DSH 完全退出后无残留 launcher.ps1；
- [ ] 强杀 DSH 后重启，旧 sidecar 不残留（若残留需手动清理并记录）；
- [ ] 同时开 web/desktop 两个 DSH profile，仅一个 sidecar 生效，另一个有明确提示（当前为静默互斥，计划改进）；
- [ ] 同一 profile 下反复重启 DSH 10 次，每次热键都可用。

### 6.5 任务 / 步数预算（功能回归）
- [ ] 搜索类任务：完成后 1 行结果，不滚动/不总结；
- [ ] 复杂表单：能完成，步数在预算内；
- [ ] 故意设 maxSteps=5 的复杂任务：超限停止且 HUD 提示；
- [ ] 默认不截图（≤2 张兜底）；
- [ ] 桌面后端缺失（禁用 computer-use-win）时提示而不是提交任务。

### 6.6 审批
- [ ] 触发审批时右下角弹窗，中文文案正确；
- [ ] Enter 通过 / Backspace 拒绝；
- [ ] 超时自动拒绝；
- [ ] approvalPopup=false 时退回 DSH 原生审批。

### 6.7 语言 / 文案
- [ ] 中文系统 auto=中文；强制 en=英文；
- [ ] 输入框、HUD、审批弹窗、设置页、任务协议一致；
- [ ] GB2312 系统上中文显示正常（由宿主 base64 传入，不依赖 .ps1 文件编码）。

### 6.8 发布 / 市场
- [ ] `npm pack` 产物包含 launcher/approval/locale/client/README/图标；
- [ ] npm 页面版本、README（图标/徽章/首屏要求）正确；
- [ ] GitHub Release 有 tgz；
- [ ] DSH Plugin Hub 条目版本更新、安装命令可用；
- [ ] 全新机器从市场一键安装后热键可用。

### 6.9 诊断与支持

- [ ] 设置 → QuickDesk → 诊断与支持显示自定义区块，按钮可用；
- [ ] 点击“运行诊断…”后弹出原生“另存为”对话框；
- [ ] 选择桌面/临时目录后生成 zip；生成完成后 `$env:TEMP\QuickDesk-Diagnostics-*` 临时目录被删除；
- [ ] 取消另存为对话框时，设置页显示“已取消诊断”，不生成 zip；
- [ ] 报告 zip 内包含 summary、environment、launcher-log、plugin-import 等文件；
- [ ] 报告中的诊断结论与机器实际状态一致；
- [ ] 把报告发给开发者前，确认里面没有不该外传的敏感信息（报告含本机路径/用户名）。

## 7. 已知缺口 / 下一步

1. **L3 Host 集成自动化**：需要把 `apply(ctx)` 的 DSH 依赖抽成可注入的 mock（或提供测试用 fake DSH ctx），覆盖 settings watcher / 预算取消 / 审批接管；
2. **客户端设置页 UI 自动化**：可用 Playwright 对 DSH web 设置页做表单校验/保存/回读；
3. **多实例/孤儿锁**：修复 sidecar 生命周期后补充"stdin EOF 退出"和"看门狗重启"断言；
4. **长稳测试**：连续运行 24h、任务 100 次，检查句柄/进程泄漏；
5. **代码签名/杀软**：安装包/ps1 在开启 Defender 的干净机器上验证不误报。

## 8. 缺陷回归规则

每个线上问题修复必须新增至少一个自动化测试，命名对应风险，并保证：
- 修复前该测试失败（能复现）；
- 修复后该测试通过；
- 在 `docs/TESTING.md` 覆盖矩阵中登记。

本次 1.2.0 热键失效的回归测试：
- `scripts/tests/encoding.test.mjs`（ASCII-only）
- `scripts/tests/powershell-syntax.test.mjs`（GB2312 读取模拟）
