# chrome-auto-connect-win Skill

## 概述

Windows 上连接已运行的 Chrome，并自动处理“要允许远程调试吗？ / Allow remote debugging?”
确认弹窗。适用于智能体或脚本流程：先确保后台监听，再让 `chrome-devtools` 等客户端
连接 Chrome，弹窗会被 Windows UI Automation 自动点击。

本工具不修改 Chrome、不注入进程、不使用屏幕坐标；只点击符合标题和按钮名称的确认弹窗。
仅在获得授权的 Windows 机器上使用。

## 前置条件

- Windows 10/11、Node.js >= 22、Windows PowerShell 5.1
- Chrome 已启用远程调试（`chrome://inspect/#remote-debugging`），并写入
  `%LOCALAPPDATA%\Google\Chrome\User Data\DevToolsActivePort`
- 终端与 Chrome 使用相同的权限级别（通常都不要管理员）

## 推荐流程

```bash
# 1. 检查环境；--json 便于解析
chrome-auto-connect-win status --json

# 2. 必要时先 dry-run 验证按钮能被识别
chrome-auto-connect-win once --dry-run --timeout 5 --json

# 3. 启动常驻监听（默认还会连接 chrome-devtools）
chrome-auto-connect-win start --json

# 没有安装 chrome-devtools 时只启动监听
chrome-auto-connect-win start --no-connect --json

# 4. 让业务客户端连接 Chrome；弹窗自动点击
# 5. 收尾
chrome-auto-connect-win stop --json
```

一次性场景：

```bash
chrome-auto-connect-win once --json
chrome-auto-connect-win allow --json          # 后台一次性监听，立即返回
chrome-auto-connect-win allow --sync --json   # 前台等待结果
```

## JSON 结果

`once` / `allow --sync` 成功点击：

```json
{
  "status": "ok",
  "result": "clicked",
  "message": "成功点击「允许」按钮",
  "exitCode": 0,
  "candidate": {
    "name": "允许",
    "dialogName": "要允许远程调试吗？",
    "processId": 1234
  },
  "elapsedMs": 12
}
```

dry-run：

```json
{
  "status": "ok",
  "result": "would_click",
  "message": "检测到「允许」按钮（dry-run，未点击）",
  "exitCode": 0,
  "dryRun": true,
  "candidate": { "name": "Allow", "dialogName": "Allow remote debugging?" }
}
```

其他 `result`：`timeout`、`no_chrome`、`permission_denied`、`error`。

`status --json` 关键字段：

- `daemon.running` / `daemon.pid` / `daemon.lastEvent`
- `allow.running` / `allow.pid`
- `chrome.running` / `chrome.processes`
- `endpoint.available` / `endpoint.wsEndpoint` / `endpoint.reason`
- `uia.ok` / `uia.selected` / `uia.candidateCount` / `uia.permissionIssues`
- `pages.checked` / `pages.problemCount` / `pages.problems`
- `powershell.available`、`devtools.available`

## 退出码

| 退出码 | 含义 |
|--------|------|
| 0 | 成功（点击或 dry-run 检测到；其他命令成功） |
| 1 | 超时、参数错误、重复启动、连接失败 |
| 2 | Chrome 未运行 |
| 3 | 权限不足、UI Automation/PowerShell 或执行错误 |

## 智能体决策建议

1. 先 `status --json`；若 `uia.ok` 为 false，根据 `uia.code`/`hint` 处理，不要重试点击。
2. 若 `daemon.running` 为 false，启动 `start --no-connect`（除非明确需要自动连接）。
3. 若需要确认弹窗确实存在，用 `once --dry-run --json`；不要只看进程状态。
4. 若 `once` 返回 `no_chrome`，提示用户启动 Chrome；不要反复启动。
5. 若返回 `permission_denied`，提示用户统一权限级别；不要尝试提权绕过。
6. 流程结束后运行 `stop`，避免长期驻留。

## 可配置项

- 按钮/标题：`--button "Allow,允许"`、`--title "remote debugging,远程调试"`
- 轮询：`--interval 300`
- 超时：`--timeout 10` 或 `--timeout-ms 10000`
- 防重复点击：`--click-cooldown 2000`、`--max-clicks 3`
- 进程名：`--process-name chrome`
- 自定义 profile：`--user-data-dir <dir>` 或 `--port-file <DevToolsActivePort>`
- 隔离状态：`--state-dir <dir>`
- 日志与调试：`--json`、`--debug`、`--log-level debug`

## 安全边界

- 只在用户已启动的 Chrome 上工作；不会启动/重启 Chrome。
- 只接受 `Allow` / `允许` 按钮，且祖先 Window 标题必须匹配远程调试片段。
- 不操作普通网页中的同名按钮（排除 Document 祖先）。
- 不修改系统执行策略、不写注册表、不安装服务。
- 不实现提权、进程注入、内存修改或屏幕坐标点击。