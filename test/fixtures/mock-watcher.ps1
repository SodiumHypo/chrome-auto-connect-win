param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigFile
)

# Test double for scripts/allow-clicker.ps1. ASCII-only source; localized
# strings are built from code points and emitted through a UTF-8 console.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$cfg = Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json

function Emit {
    param([hashtable]$Data)
    [Console]::Out.WriteLine(($Data | ConvertTo-Json -Depth 8 -Compress))
    [Console]::Out.Flush()
}

$cnAllow = [string]::Concat([char]0x5141, [char]0x8BB8)
$cnDialog = [string]::Concat(
    [char]0x8981, [char]0x5141, [char]0x8BB8, [char]0x8FDC, [char]0x7A0B,
    [char]0x8C03, [char]0x8BD5, [char]0x5417, [char]0xFF1F)
$enDialog = 'Allow remote debugging?'

$scenario = [string]$env:CAC_WIN_MOCK_SCENARIO
if ([string]::IsNullOrWhiteSpace($scenario)) {
    if ([bool]$cfg.probe) { $scenario = 'probe' }
    elseif ([bool]$cfg.follow) { $scenario = 'follow' }
    elseif ([bool]$cfg.dryRun) { $scenario = 'would_click' }
    else { $scenario = 'clicked' }
}

Emit @{ event = 'start'; mode = 'mock'; scenario = $scenario; dryRun = [bool]$cfg.dryRun }

switch ($scenario) {
    'clicked' {
        if ([bool]$cfg.dryRun) {
            Emit @{
                event = 'would_click'
                candidate = @{ name = $cnAllow; dialogName = $cnDialog; processId = 1234 }
                elapsedMs = 12
            }
            exit 0
        }
        Emit @{
            event = 'clicked'
            candidate = @{ name = $cnAllow; dialogName = $cnDialog; processId = 1234 }
            method = 'invoke'
            elapsedMs = 12
        }
        exit 0
    }
    'would_click' {
        Emit @{
            event = 'would_click'
            candidate = @{ name = 'Allow'; dialogName = $enDialog; processId = 1234 }
            elapsedMs = 12
        }
        exit 0
    }
    'timeout' {
        Emit @{ event = 'timeout'; elapsedMs = [int]$cfg.timeoutMs }
        exit 1
    }
    'no_chrome' {
        Emit @{ event = 'no_chrome'; chromeProcessCount = 0 }
        exit 2
    }
    'permission_denied' {
        Emit @{
            event = 'permission_denied'
            code = 'uia_access_denied'
            message = 'Access denied'
            hint = 'Run at the same elevation as Chrome'
        }
        exit 3
    }
    'error' {
        Emit @{ event = 'error'; code = 'uia_unavailable'; message = 'UIA missing' }
        exit 3
    }
    'follow' {
        while ($true) {
            Start-Sleep -Milliseconds 200
        }
    }
    'probe' {
        Emit @{
            event = 'probe'
            uiaAvailable = $true
            chromeRunning = $true
            chromeProcessCount = 1
            chromeProcesses = @(@{ pid = 1234; name = 'chrome' })
            windows = @(@{ processId = 1234; name = $cnDialog; className = 'RootView' })
            candidates = @(@{
                name = $cnAllow
                dialogName = $cnDialog
                processId = 1234
                className = 'MdTextButton'
                automationId = ''
                runtimeId = '42-1'
                boundingRect = '1,2,3,4'
                isOffscreen = $false
                isEnabled = $true
            })
            selected = @{ name = $cnAllow; dialogName = $cnDialog; processId = 1234 }
            reason = 'title_match'
            permissionIssues = 0
        }
        exit 0
    }
    default {
        Emit @{ event = 'error'; code = 'unknown_scenario'; message = $scenario }
        exit 3
    }
}