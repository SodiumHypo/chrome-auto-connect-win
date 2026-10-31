'use strict';

const HELP_TEXT = `chrome-auto-connect-win - Windows 版 Chrome 远程调试确认弹窗自动点击工具

用法:
  chrome-auto-connect-win <command> [options]
  兼容命令: chrome-auto-connect <command> [options]

命令:
  start     启动后台守护进程，持续自动点击「允许 / Allow」确认弹窗
            默认在启动后通过 chrome-devtools 连接并列出页面；--no-connect 可跳过
  stop      停止守护进程和一次性监听
  status    查看守护进程、Chrome、DevTools 端点、UI Automation 和页面状态
  once      前台运行一次检测（可选 --dry-run），等待并点击或超时退出
  allow     后台运行一次性检测；--sync 等价于 once
  connect   只连接现有 DevTools 端点并执行 chrome-devtools list_pages
  help      显示帮助
  version   显示版本

常用选项:
  --dry-run              只检测并报告，不点击
  --sync                 允许/一次性检测在前台等待结果（仅 allow）
  --foreground           守护进程在前台运行，Ctrl+C 停止（仅 start；默认不自动连接）
  --connect              启动后连接（start 默认行为，可省略）
  --no-connect           只启动守护进程，不连接（仅 start）
  --timeout <秒>         单次检测超时，默认 5 秒
  --timeout-ms <毫秒>    同上，以毫秒为单位
  --interval <毫秒>      轮询间隔，默认 500
  --button <名称,...>    确认按钮名称，默认 "Allow,允许"
  --title <文本,...>     弹窗标题匹配片段，默认 "remote debugging,远程调试"
  --process-name <名称>  Chrome 进程名，默认 chrome；可重复或逗号分隔
  --click-cooldown <毫秒> 点击后的冷却时间，默认 2000
  --max-clicks <次数>    同一弹窗最多点击次数，默认 3
  --no-page-check        status/connect 跳过 CDP 页面检查
  --probe                status 输出完整候选控件信息
  --json                 以 JSON 输出结果（stdout）
  --debug                调试日志级别
  --quiet                安静模式
  --log-level <级别>     silent|error|warn|info|debug
  --log-file <路径>      守护进程日志路径
  --state-dir <目录>     状态目录（PID、锁、配置、日志）
  --pid-file <路径>      守护进程 PID 文件
  --user-data-dir <目录> Chrome User Data 目录（用于定位 DevToolsActivePort）
  --port-file <路径>     DevToolsActivePort 文件路径
  --ps-path <路径>       powershell.exe 路径
  --ps-script <路径>     allow-clicker.ps1 路径
  --devtools-command <命令> chrome-devtools 命令名或路径
  -h, --help             显示帮助
  -v, --version          显示版本

示例:
  chrome-auto-connect-win start
  chrome-auto-connect-win start --no-connect --interval 300
  chrome-auto-connect-win once --dry-run
  chrome-auto-connect-win allow --sync --timeout 10
  chrome-auto-connect-win status --json
  chrome-auto-connect-win stop

环境要求:
  - Windows 10/11；Windows PowerShell 5.1（powershell.exe）
  - Node.js >= 22
  - Chrome 136+；如使用 chrome://inspect/#remote-debugging 开关，Chrome 需已启用远程调试
  - 与 Chrome 相同的权限级别运行；不要对管理员权限的 Chrome 使用普通终端

退出码 (once / allow --sync):
  0 已点击或 dry-run 检测到按钮
  1 超时、参数错误或已在运行
  2 Chrome 未运行
  3 权限不足、UI Automation 或执行错误

注意: 本工具只对用户已经启动的 Chrome 确认弹窗做 UI 自动化点击；
      不修改 Chrome 二进制、不注入进程、不使用屏幕坐标硬编码。`;

module.exports = {
  HELP_TEXT
};