# chrome-auto-connect-win

Windows 版 Chrome 远程调试确认弹窗自动点击工具，是
[x99wang/chrome-auto-connect](https://github.com/x99wang/chrome-auto-connect)（macOS/AppleScript）
的独立移植版。它通过 Windows UI Automation 检测并点击 Chrome 的
“要允许远程调试吗？ / Allow remote debugging?” 弹窗，让 `chrome-devtools` 等客户端
无需人工点击即可继续连接。

- 不修改 Chrome 二进制
- 不注入进程
- 不使用屏幕坐标硬编码
- 只对用户已经启动的 Chrome 确认弹窗执行 UI 自动化点击

> 本仓库当前**未执行 `npm publish`**。下面的 `npm install -g chrome-auto-connect-win`
> 适用于包发布之后；现在请使用本地 tarball 安装（见“安装”一节）。

## 功能

1. 自动检测 Chrome 的“允许 / Allow”确认弹窗并点击。
2. 支持中文和英文 Chrome UI，默认按钮为 `Allow,允许`，默认标题片段为
   `remote debugging,远程调试`，均可通过命令行覆盖。
3. 后台守护进程持续监听，支持多窗口、多弹窗、重复弹窗和进程退出清理。
4. 提供 `start`、`stop`、`status`、`once`、`allow`、`connect` 命令。
5. 保留 macOS 原项目的 `status`、`start`、`allow` 命令和兼容 bin 名称。
6. 可选通过 `chrome-devtools` CLI 自动连接并执行 `list_pages`。
7. 零运行时 npm 依赖：使用 Node.js 内置 WebSocket 和 Windows PowerShell 5.1 的
   UI Automation。

## 与 macOS 原项目的差异

| 项目 | macOS 原项目 | Windows 移植版 |
|------|--------------|----------------|
| 弹窗点击 | AppleScript / System Events | PowerShell 5.1 + .NET UI Automation |
| 系统权限 | 需要“辅助功能”权限 | 需要与 Chrome 相同的完整性级别（UIPI），通常不需要管理员 |
| 包名 | `chrome-auto-connect` | `chrome-auto-connect-win` |
| bin | `chrome-auto-connect` | `chrome-auto-connect-win`，并额外提供兼容名 `chrome-auto-connect` |
| 命令 | `status`、`start`、`allow` | 保留以上命令，新增 `stop`、`once`、`connect` |
| 后台管理 | shell 脚本后台进程 | Node 守护进程 + PID 文件 + 锁文件 |
| 默认超时 | 原脚本约 5 秒（README 写作 2 秒） | 5 秒，可通过 `--timeout` 修改 |
| 依赖 | `chrome-devtools-mcp`、`ws` | 无 npm 运行时依赖；`chrome-devtools` CLI 可选 |

`start` 与原项目一致：启动监听后默认通过 `chrome-devtools` 连接并执行
`list_pages`；使用 `--no-connect` 可只启动守护进程。

> 注意：本包安装了兼容 bin 名称 `chrome-auto-connect`。如果同时安装 macOS 原包，
> 后安装者会覆盖同名命令。请用 `chrome-auto-connect-win` 明确调用 Windows 版。

## 环境要求

- Windows 10/11（x64 / arm64）
- Node.js >= 22（使用内置 `WebSocket`）
- Windows PowerShell 5.1（`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`，
  Windows 自带）。PowerShell 7 可能没有 `UIAutomationClient`，本工具优先使用 5.1。
- Google Chrome 136+；推荐 Chrome 144+，其 `chrome://inspect/#remote-debugging`
  开关会持久化远程调试设置。
- 可选：`chrome-devtools` CLI（来自 `chrome-devtools-mcp`），仅 `start` 的自动连接和
  `connect` 命令需要。

## 安装

### 本地 tarball（当前推荐）

```bash
npm pack
npm install -g ./chrome-auto-connect-win-1.0.0.tgz
chrome-auto-connect-win --version
```

也可以安装到临时目录做隔离验证：

```bash
mkdir C:\temp\cac-win-test
cd C:\temp\cac-win-test
npm init -y
npm install D:\path\to\chrome-auto-connect-win-1.0.0.tgz
npx chrome-auto-connect-win --help
```

### 发布后

```bash
npm install -g chrome-auto-connect-win
# 或
npx chrome-auto-connect-win --help
```

### 从源码

```bash
git clone <your-repo-url>
cd chrome-auto-connect-win
npm install
npm test
npm link        # 可选，链接 bin 到全局
```

## 快速开始

1. 在 Chrome 中打开 `chrome://inspect/#remote-debugging`，启用远程调试开关
   （Chrome 144+ 的“允许为此浏览器实例启用远程调试”）。重启 Chrome 后，
   Chrome 会写入 `DevToolsActivePort` 并在需要时弹出确认对话框。
2. 在终端运行：

```bash
# 持续监听并自动点击；默认还会调用 chrome-devtools 连接并列出页面
chrome-auto-connect-win start

# 只启动监听，不连接（没有安装 chrome-devtools 时使用）
chrome-auto-connect-win start --no-connect

# 查看状态
chrome-auto-connect-win status

# 停止
chrome-auto-connect-win stop
```

如果只想临时处理一次弹窗：

```bash
chrome-auto-connect-win once              # 前台等待并点击，超时退出
chrome-auto-connect-win once --dry-run    # 只检测，不点击
```

## 命令

| 命令 | 说明 |
|------|------|
| `start` | 启动后台守护进程。默认随后执行 `chrome-devtools start --wsEndpoint ...` 和 `list_pages`；`--no-connect` 跳过连接 |
| `stop` | 停止守护进程和后台一次性监听，清理 PID/锁文件；`--dry-run` 只报告 |
| `status` | 查看守护进程、Chrome、DevTools 端点、PowerShell、UI Automation 和页面检查结果 |
| `once` | 前台执行一次检测；`--dry-run` 只报告；适合脚本和手工验证 |
| `allow` | 后台执行一次检测；`--sync` 等价于 `once`，保留原项目命令 |
| `connect` | 只连接现有 DevTools 端点并执行 `chrome-devtools list_pages` |
| `help` | 帮助 |
| `version` | 版本 |

### `start`

```bash
chrome-auto-connect-win start [--connect|--no-connect] [--foreground]
                              [--interval 500] [--timeout 5]
                              [--button "Allow,允许"] [--title "remote debugging,远程调试"]
                              [--process-name chrome] [--dry-run]
                              [--state-dir <dir>] [--user-data-dir <dir>]
```

- 默认后台运行，PID 写入 `%LOCALAPPDATA%\chrome-auto-connect-win\daemon.json`。
- 已有存活守护进程时退出码 1，不会重复启动。
- `--foreground` 在当前终端运行，按 Ctrl+C 停止；此模式默认不自动连接。
- `--dry-run` 只记录“将点击”，不实际点击。
- `start` 的自动连接失败不会停止守护进程；状态和警告会输出。
- 守护进程日志为 JSON Lines，默认 `%LOCALAPPDATA%\chrome-auto-connect-win\daemon.log`。

### `status`

```bash
chrome-auto-connect-win status [--json] [--probe] [--no-page-check]
```

报告包括：

- 守护进程 / 一次性监听 PID 状态（含陈旧 PID 文件检测）
- Chrome 进程列表
- `DevToolsActivePort` 是否存在、端口是否监听
- PowerShell 和 UI Automation 可用性
- 当前是否检测到确认弹窗（`--probe` 输出完整候选控件）
- CDP `Target.getTargets` 页面检查结果（`--no-page-check` 跳过）

### `once` / `allow`

```bash
chrome-auto-connect-win once [--dry-run] [--json] [--timeout 5]
chrome-auto-connect-win allow [--sync] [--dry-run] [--json] [--timeout 5]
```

退出码与原 watcher 语义一致：

| 退出码 | 含义 |
|--------|------|
| 0 | 已点击，或 dry-run 检测到按钮 |
| 1 | 超时、参数错误、重复启动 |
| 2 | Chrome 未运行 |
| 3 | 权限不足、UI Automation/PowerShell 错误 |

`allow` 默认在后台启动一次性监听并立即返回；结果写入
`%LOCALAPPDATA%\chrome-auto-connect-win\allow.log`。`allow --sync` 前台等待并返回结果。

### `connect`

```bash
chrome-auto-connect-win connect [--no-page-check] [--devtools-command chrome-devtools]
```

读取 `DevToolsActivePort`，可选执行页面检查，然后运行
`chrome-devtools start --wsEndpoint ...` 和 `list_pages`。没有安装 `chrome-devtools` 时
请使用 `once` 或 `start --no-connect`。

## 选项

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `--timeout <秒>` | 5 | 一次性检测超时 |
| `--timeout-ms <毫秒>` | — | 同上，毫秒 |
| `--interval <毫秒>` | 500 | 轮询间隔，最小 50ms |
| `--button <名称,...>` | `Allow,允许` | 确认按钮名称；可重复 |
| `--title <片段,...>` | `remote debugging,远程调试` | 弹窗标题匹配片段；可重复 |
| `--process-name <名称,...>` | `chrome` | Chrome 进程名；可重复 |
| `--click-cooldown <毫秒>` | 2000 | 点击后的冷却时间 |
| `--max-clicks <次数>` | 3 | 同一弹窗最多点击次数 |
| `--dry-run` | 关闭 | 只检测，不点击 |
| `--sync` | 关闭 | `allow` 前台等待 |
| `--foreground` | 关闭 | `start` 前台运行 |
| `--connect` / `--no-connect` | 连接 | `start` 是否执行 chrome-devtools 连接 |
| `--no-page-check` | 关闭 | `status`/`connect` 跳过页面检查 |
| `--probe` | 关闭 | `status` 输出完整候选控件 |
| `--json` | 关闭 | stdout 输出 JSON |
| `--debug` / `--quiet` | 关闭 | 调试 / 安静日志级别 |
| `--log-level <级别>` | info | `silent,error,warn,info,debug` |
| `--log-file <路径>` | 状态目录下 | 守护进程日志 |
| `--state-dir <目录>` | `%LOCALAPPDATA%\chrome-auto-connect-win` | PID、锁、配置、日志目录 |
| `--pid-file <路径>` | 状态目录/daemon.json | 守护进程 PID 文件 |
| `--user-data-dir <目录>` | 默认 Chrome User Data | 定位 `DevToolsActivePort` |
| `--port-file <路径>` | User Data/DevToolsActivePort | 直接指定端口文件 |
| `--ps-path <路径>` | `powershell.exe` | PowerShell 可执行文件 |
| `--ps-script <路径>` | 包内 `allow-clicker.ps1` | UIA 助手脚本 |
| `--devtools-command <命令>` | `chrome-devtools` | chrome-devtools CLI |
| `-h, --help` / `-v, --version` | — | 帮助 / 版本 |

## 工作原理

1. Node CLI 解析命令并管理守护进程、PID 文件、锁文件和日志。
2. 守护进程启动 Windows PowerShell 5.1，加载
   `scripts/allow-clicker.ps1` 和 `scripts/uia-matcher.ps1`。
3. PowerShell 通过 `System.Windows.Automation`：
   - 按 PID 枚举 Chrome 顶层窗口；
   - 查找 `ControlType.Button` 且名称等于 `Allow` / `允许` 的控件；
   - 向上遍历父级，要求位于标题含 `remote debugging` / `远程调试` 的 Window 内；
   - 排除 Document 内的普通网页按钮、offscreen 控件和 disabled 控件；
   - 使用 `InvokePattern.Invoke()` 点击，必要时回退到 `LegacyIAccessiblePattern`。
4. 事件以 UTF-8 JSON Lines 输出给 Node；Node 负责结果映射、日志和退出码。
5. 同一弹窗有冷却和最大点击次数限制，避免重复点击；点击后弹窗消失则由下一轮
   枚举自然清理。

中文字符串不写入 `.ps1` 源码（Windows PowerShell 5.1 会按系统 ANSI 代码页解析无 BOM
脚本），而是由 Node 以 UTF-8 JSON 配置传入；PowerShell 5.1 以 `-Encoding UTF8`
读取并强制 UTF-8 输出，避免乱码导致的匹配失败。

## Chrome 远程调试设置

Chrome 136 起，远程调试的确认流程与旧版本不同；Chrome 144+ 提供
`chrome://inspect/#remote-debugging` 开关：

1. 打开 `chrome://inspect/#remote-debugging`。
2. 启用“允许远程调试 / Allow remote debugging for this browser instance”。
3. 重启 Chrome。设置会保存在 `Local State` 中，Chrome 随后自动监听端口（默认 9222）
   并写入 `%LOCALAPPDATA%\Google\Chrome\User Data\DevToolsActivePort`。
4. 启动 `chrome-auto-connect-win start`。当新的 CDP 客户端连接时，Chrome 可能弹出
   每次连接的确认对话框，守护进程会自动点击“允许”。

也可以使用 `--remote-debugging-port` 启动 Chrome，但不同 Chrome 版本/配置下不一定
触发同样的确认弹窗；本工具的检测逻辑只在弹窗实际出现时生效。使用自定义 profile 时，
通过 `--user-data-dir` 或 `--port-file` 指向对应文件。

> 页面检查本身会创建一个新的 CDP 连接；在 Chrome 的“每次连接确认”模式下，它也可能
> 触发一次弹窗。`start` 的自动连接会跳过页面检查以减额外弹窗；独立 `connect`
> 命令仍会按默认行为检查页面。

## 权限与安全

- **完整性级别**：Windows UIPI 允许低/同完整性级别进程访问高完整性级别窗口，反之
  会被拒绝。若 Chrome 以管理员身份运行，请在同样以管理员身份运行的终端中使用本工具；
  若 Chrome 以普通用户运行，不要以管理员终端运行本工具（可能读不到 Chrome 窗口）。
- 正常使用**不需要管理员权限**。
- `powershell.exe` 仅以子进程参数 `-NoProfile -NonInteractive -ExecutionPolicy Bypass
  -File` 执行包内脚本；不会修改系统或用户的 ExecutionPolicy。
- 企业策略、EDR、屏幕锁定时 UIA 可能被阻止；此时 `status` 会报告
  `permission_denied`，工具不会绕过任何安全策略。
- 本工具只点击标题匹配的确认弹窗中的“允许 / Allow”按钮，不会修改 Chrome 可执行文件、
  不注入进程、不模拟屏幕坐标。它不替代 Chrome 的安全机制；请仅在你拥有或获授权使用的
  机器上运行，不要用它替他人做授权决定。

## 故障排查

### 找不到弹窗 / 超时

- 确认 Chrome 已启用远程调试，且 `status` 显示 `DevTools 端点: 可用`。
- 单次 `once` 只等待 5 秒；Chrome 可能在连接建立后才弹窗，可增大
  `--timeout 15`，或使用常驻的 `start`。
- 用 `status --probe` 查看 UIA 是否能枚举 Chrome 窗口和按钮。
- 用 `--debug` 或查看 `daemon.log` 中的 `tick`/`clicked` 事件。
- 若页面停留在 `about:blank` 等页面，Chrome 可能不会触发弹窗；先打开普通网页。

### 权限不足 / `uia_access_denied`

- 确认终端与 Chrome 的启动身份（管理员/普通用户）一致。
- 关闭以管理员身份运行的 Chrome，或把终端也以管理员身份运行。
- 检查企业安全软件是否阻止 UI Automation。

### 后台进程重复启动 / 无法停止

```bash
chrome-auto-connect-win status
chrome-auto-connect-win stop
chrome-auto-connect-win stop --dry-run   # 只查看会停止什么
```

PID/锁文件位于状态目录。`stop` 只会终止 PID 文件看起来属于本工具的进程；不是本工具的
PID 文件会被跳过并报告。

### `chrome-devtools` 连接失败

```bash
npm install -g chrome-devtools-mcp@latest
chrome-auto-connect-win status
```

或先用 `start --no-connect` 保持监听，再在另一个终端运行 `connect`。如果弹窗仍在，
说明自动点击没有生效，请按上一节排查。

### PowerShell 7 报 `uia_unavailable`

安装/启用 Windows PowerShell 5.1（Windows 10/11 自带），或通过
`--ps-path C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` 指定。

### Chrome 版本差异

Chrome 的确认弹窗是自绘 UI，UIA 结构可能随版本变化。当前实现已在本机 Chrome 156
的中文 UI 上验证；如果新版本改变按钮名称或层级，可通过 `--button`、`--title`
调整，并用 `status --probe` 查看实际控件信息。

## 退出码

| 退出码 | `once` / `allow --sync` | 其他命令 |
|--------|--------------------------|----------|
| 0 | 点击成功或 dry-run 检测到按钮 | 成功 |
| 1 | 超时、参数错误、重复启动 | 参数错误、重复启动、连接失败 |
| 2 | Chrome 未运行 | — |
| 3 | 权限/UI Automation/PowerShell 错误 | 执行错误 |

## 开发与测试

```bash
npm install
npm test                 # Node 单元测试 + PowerShell 匹配测试 + CLI 集成测试
npm run test:ps          # 仅 PowerShell 中英文匹配测试
npm run pack:check       # npm pack --dry-run
npm pack
```

测试使用 `test/fixtures/mock-watcher.ps1` 模拟 PowerShell 桥接，覆盖点击、dry-run、
无 Chrome、超时、权限错误、守护进程重复启动/停止、后台一次性监听和中英文匹配。
真实 Chrome 验证记录见 [docs/windows-validation.md](docs/windows-validation.md)。

## MCP 环境提示

如果通过 Chrome DevTools MCP 使用本工具，请确保 MCP 配置带 `--auto-connect`，
否则 MCP 可能启动新的浏览器实例，而不是连接已运行的 Chrome：

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["chrome-devtools-mcp", "--auto-connect"]
    }
  }
}
```

## 许可证

MIT。原 macOS 项目版权归 x99wang（2026）；Windows 移植部分版权归
chrome-auto-connect-win contributors（2026）。详见 [LICENSE](LICENSE)。