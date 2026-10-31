# Windows 验证记录

本文件记录 Windows 移植版的本地真实验证结果，供发布前复核。

## 验证环境

- Windows 11 Pro 10.0.26300
- Node.js v24.18.0（项目要求 >= 22）
- Windows PowerShell 5.1（`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`）
- Google Chrome 156，中文 UI，已通过 `chrome://inspect/#remote-debugging` 启用远程调试
- Chrome 默认 profile；`DevToolsActivePort` 位于
  `%LOCALAPPDATA%\Google\Chrome\User Data\DevToolsActivePort`
- 终端与 Chrome 均为普通用户权限
- 验证时未安装全局 `chrome-devtools` CLI，因此自动连接步骤单独标注

## 已通过

### 1. 真实 Chrome 中文弹窗（dry-run）

触发方式：用 Node 内置 WebSocket 连接 Chrome browser endpoint 并保持连接，Chrome 弹出
“要允许远程调试吗？”对话框。

```bash
chrome-auto-connect-win once --dry-run --timeout 15
```

结果（退出码 0）：

```
检测到「允许」按钮（dry-run，未点击）
  按钮: 允许，窗口: 要允许远程调试吗？，PID: <chrome-pid>
  耗时: 0ms
  dry-run: 未实际点击
```

### 2. 真实 Chrome 中文弹窗（实际点击）

```bash
chrome-auto-connect-win once --timeout 15
```

结果（退出码 0）：

```
成功点击「允许」按钮
  按钮: 允许，窗口: 要允许远程调试吗？，PID: <chrome-pid>
  耗时: 0ms
```

被阻塞的 CDP 客户端随后收到 `Target.getTargets` 响应，证明点击解锁了远程调试连接。
UIA 候选信息示例：

- 按钮：`允许`
- 窗口：`要允许远程调试吗？`
- 类名：`MdTextButton`
- `isOffscreen: false`、`isEnabled: true`
- `InvokePattern.Invoke()` 成功

### 3. 守护进程常驻点击

```bash
chrome-auto-connect-win start --no-connect --interval 200 --state-dir <tmp>
node <holder>.js        # 新的 CDP 连接触发弹窗
chrome-auto-connect-win status --state-dir <tmp> --json
chrome-auto-connect-win stop --state-dir <tmp>
```

结果：

- 守护进程 PID 文件写入并存活
- 新 CDP 连接触发弹窗后，守护进程日志记录 `clicked`，`method: invoke`
- CDP 客户端收到响应
- `status` 显示守护进程运行中、`lastEvent.event = clicked`
- `stop` 正常终止守护进程并删除 PID 文件

### 4. 自动化测试

```bash
npm test
```

覆盖：

- 中英文按钮/标题匹配（真实 Windows PowerShell 5.1 执行）
- dry-run、no_chrome、timeout、permission_denied 结果映射
- 守护进程 start/status/stop、重复启动拒绝
- 后台一次性 allow、重复启动拒绝
- PID 文件、锁文件、陈旧 PID 清理
- CDP 页面分类与 WebSocket 超时/错误
- chrome-devtools 命令调用（mock）
- UTF-8 中文字符串经 JSON 配置传入 PowerShell 的桥接

本机结果：`tests 62, pass 62, fail 0`。

### 5. tarball 安装验证

将 `npm pack` 生成的 `chrome-auto-connect-win-1.0.0.tgz` 安装到独立的临时项目：

```bash
npm install ../../chrome-auto-connect-win/chrome-auto-connect-win-1.0.0.tgz
```

结果：

- tarball 的 SHA-256 以最终 `npm pack` 输出为准（本文件也在包内，不在文档中固定哈希）
- 安装后同时提供 `chrome-auto-connect-win` 和兼容命令 `chrome-auto-connect`
  （含 Windows 的 `.cmd` / `.ps1` shim）
- 两个命令的 `--version` 均输出 `chrome-auto-connect-win 1.0.0`
- `--help` 退出码 0
- `status --no-page-check` 退出码 0；检测到 8 个 Chrome 进程，UI Automation 可用
- 无弹窗时 `once --dry-run --timeout 1` 退出码 1（超时，符合预期）
- 触发真实中文弹窗后，使用安装包内的 `scripts/allow-clicker.ps1`：
  - `once --dry-run --timeout 15` 退出码 0，报告“检测到「允许」按钮”
  - `once --timeout 15` 退出码 0，报告“成功点击「允许」按钮”
  - 被阻塞的 CDP 客户端随后收到 `Target.getTargets` 响应，确认点击解锁连接

tarball 文件检查：共 32 个条目，仅包含 `package.json`、`README.md`、`LICENSE`、
`SKILL.md`、`bin/`、`src/`、`scripts/*.ps1`、`docs/*.md`；不含 `test/`、
临时文件、日志、tarball 或 `package-lock.json`。

## 未在本机验证（需手工复核）

1. **英文 Chrome UI 的真实弹窗**：本机 Chrome 为中文 UI。英文按钮/标题匹配已由
   PowerShell 匹配测试覆盖（`Allow`、`Allow remote debugging?`），但未触发真实英文弹窗。
   手工步骤：将 Chrome UI 语言切换为 English 后重复“真实 Chrome 中文弹窗”步骤。
2. **权限不足场景**：未让 Chrome 以管理员身份运行，因此未真实触发
   `permission_denied`。手工步骤：以管理员身份启动 Chrome，用普通终端运行
   `once`，确认返回退出码 3 和 `uia_access_denied`；再用管理员终端确认可点击。
3. **多个 Chrome 窗口/多个弹窗同时存在**：逻辑上按窗口枚举并逐个点击，单元测试覆盖
   候选过滤和选择；本机未构造多窗口真实弹窗矩阵。
4. **Chrome 136–155 各版本**：仅验证 Chrome 156。更高/更低版本若 UIA 结构变化，
   可能需要调整 `--button` / `--title`，可用 `status --probe` 诊断。
5. **`chrome-devtools` 自动连接**：本机未安装该 CLI，`start` 的自动连接路径使用 mock
   验证（`devtools.test.js`、CLI 集成测试 mock PowerShell），未做真实 MCP/CLI 连接。
   手工步骤：`npm install -g chrome-devtools-mcp@latest`，运行
   `chrome-auto-connect-win start`，确认 `list_pages` 输出。
6. **企业策略/EDR 拦截 UI Automation**：未在受策略管控的环境验证。

## 还原与清理

- 验证使用临时 `--state-dir`，不会写入用户的默认状态目录。
- 触发弹窗的 CDP 客户端在验证结束后关闭；Chrome 未修改。
- 未创建、修改或删除 Chrome profile；仅使用已有的远程调试开关。
- 验证脚本位于工作区 `.tmp`，不属于 npm 包和 git 仓库。