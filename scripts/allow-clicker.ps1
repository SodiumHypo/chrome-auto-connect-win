param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigFile
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir 'uia-matcher.ps1')

function Write-Event {
    param([hashtable]$Data)
    $Data['timestamp'] = (Get-Date).ToUniversalTime().ToString('o')
    try {
        $json = $Data | ConvertTo-Json -Depth 8 -Compress
    } catch {
        $json = @{
            event = 'error'
            code = 'event_serialization_failed'
            message = $_.Exception.Message
            timestamp = (Get-Date).ToUniversalTime().ToString('o')
        } | ConvertTo-Json -Compress
    }
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

function Get-ConfiguredArray {
    param($Value)
    return @($Value | Where-Object { $null -ne $_ })
}

# ---------------------------------------------------------------------------
# Configuration (UTF-8 JSON written by Node.js; never rely on the .ps1 code page)
# ---------------------------------------------------------------------------
try {
    $rawConfig = Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8
    $cfg = $rawConfig | ConvertFrom-Json
} catch {
    Write-Event @{
        event = 'error'
        code = 'config_invalid'
        message = ('Unable to read PowerShell config: ' + $_.Exception.Message)
    }
    exit 3
}

$buttonNames = @(Get-ConfiguredArray $cfg.buttonNames)
$titlePatterns = @(Get-ConfiguredArray $cfg.titlePatterns)
$processNames = @(Get-ConfiguredArray $cfg.processNames)
$dryRun = [bool]$cfg.dryRun
$follow = [bool]$cfg.follow
$probe = [bool]$cfg.probe
$debug = [bool]$cfg.debug
$timeoutMs = [int]$cfg.timeoutMs
$intervalMs = [int]$cfg.intervalMs
$clickCooldownMs = [int]$cfg.clickCooldownMs
$maxClicks = [int]$cfg.maxClicksPerDialog
$clickResetMs = [int]$cfg.clickResetMs

if ($timeoutMs -lt 0) { $timeoutMs = 0 }
if ($intervalMs -lt 50) { $intervalMs = 50 }
if ($clickCooldownMs -lt 0) { $clickCooldownMs = 0 }
if ($maxClicks -lt 1) { $maxClicks = 1 }
if ($clickResetMs -lt 1000) { $clickResetMs = 1000 }
if ($buttonNames.Count -eq 0 -or $titlePatterns.Count -eq 0 -or $processNames.Count -eq 0) {
    Write-Event @{
        event = 'error'
        code = 'config_invalid'
        message = 'buttonNames, titlePatterns and processNames must not be empty.'
    }
    exit 3
}

# ---------------------------------------------------------------------------
# UI Automation initialization
# ---------------------------------------------------------------------------
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $rootElement = [System.Windows.Automation.AutomationElement]::RootElement
} catch {
    Write-Event @{
        event = 'error'
        code = 'uia_unavailable'
        message = ('Windows UI Automation is unavailable: ' + $_.Exception.Message)
        hint = 'Use Windows PowerShell 5.1 (powershell.exe) on Windows 10/11. PowerShell 7 may not ship UIAutomationClient.'
    }
    exit 3
}

$script:permissionIssues = 0
$script:permissionReported = $false
$script:lastState = ''
$script:lastWouldClickKey = ''
$script:lastWouldClickAt = [datetime]::MinValue

function Get-ChromeProcesses {
    $result = @()
    foreach ($name in $processNames) {
        $cleanName = [System.IO.Path]::GetFileNameWithoutExtension([string]$name)
        if ([string]::IsNullOrWhiteSpace($cleanName)) { continue }
        try {
            $found = @(Get-Process -Name $cleanName -ErrorAction Stop)
            $result += $found
        } catch [System.UnauthorizedAccessException] {
            $script:permissionIssues = $script:permissionIssues + 1
        } catch {
            # "No process found" is the common case and is not an error.
        }
    }
    return @($result | Sort-Object Id -Unique)
}

function Get-RuntimeIdString {
    param($Element, [string]$Fallback)
    try {
        $runtimeId = $Element.GetRuntimeId()
        if ($null -ne $runtimeId -and $runtimeId.Count -gt 0) {
            return ($runtimeId -join '-')
        }
    } catch {
        # Not all providers implement GetRuntimeId().
    }
    return $Fallback
}

function Get-PublicCandidate {
    param($Candidate)
    return [pscustomobject]@{
        name = $Candidate.name
        dialogName = $Candidate.dialogName
        processId = $Candidate.processId
        className = $Candidate.className
        automationId = $Candidate.automationId
        runtimeId = $Candidate.runtimeId
        boundingRect = $Candidate.boundingRect
        isOffscreen = $Candidate.isOffscreen
        isEnabled = $Candidate.isEnabled
    }
}

function Get-AllowCandidates {
    param($ChromeProcesses)

    $candidates = New-Object System.Collections.ArrayList
    $controlWalker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button)

    foreach ($process in $ChromeProcesses) {
        $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
            [int]$process.Id)

        try {
            $windows = $rootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
        } catch [System.UnauthorizedAccessException] {
            $script:permissionIssues = $script:permissionIssues + 1
            continue
        } catch {
            continue
        }

        foreach ($window in $windows) {
            try {
                if ($window.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) { continue }
                $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
            } catch [System.UnauthorizedAccessException] {
                $script:permissionIssues = $script:permissionIssues + 1
                continue
            } catch {
                continue
            }

            foreach ($button in $buttons) {
                try {
                    $buttonName = $button.Current.Name
                    if (-not (Test-ButtonName $buttonName $buttonNames)) { continue }

                    $offscreen = [bool]$button.Current.IsOffscreen
                    $enabled = [bool]$button.Current.IsEnabled
                    $hasDocumentAncestor = $false
                    $dialogName = ''
                    $titleTexts = @()

                    $current = $controlWalker.GetParent($button)
                    $guard = 0
                    while ($null -ne $current -and $guard -lt 64) {
                        $guard = $guard + 1
                        try {
                            $controlType = $current.Current.ControlType
                            if ($controlType -eq [System.Windows.Automation.ControlType]::Document) {
                                $hasDocumentAncestor = $true
                            }
                            $ancestorName = $current.Current.Name
                            if (-not [string]::IsNullOrWhiteSpace($ancestorName)) {
                                $titleTexts += $ancestorName
                                if ($controlType -eq [System.Windows.Automation.ControlType]::Window -and [string]::IsNullOrWhiteSpace($dialogName)) {
                                    $dialogName = $ancestorName
                                }
                            }
                        } catch {
                            break
                        }
                        $current = $controlWalker.GetParent($current)
                    }

                    if ([string]::IsNullOrWhiteSpace($dialogName)) {
                        try { $dialogName = $window.Current.Name } catch { $dialogName = '' }
                        if (-not [string]::IsNullOrWhiteSpace($dialogName)) { $titleTexts += $dialogName }
                    }

                    $rectText = ''
                    try {
                        $rect = $button.Current.BoundingRectangle
                        $rectText = ('{0},{1},{2},{3}' -f [int]$rect.X, [int]$rect.Y, [int]$rect.Width, [int]$rect.Height)
                    } catch {
                        $rectText = ''
                    }

                    $runtimeId = Get-RuntimeIdString $button $rectText
                    $dialogKey = ('{0}|{1}|{2}' -f [int]$process.Id, $dialogName, $runtimeId)

                    $candidates.Add([pscustomobject]@{
                        name = $buttonName
                        dialogName = $dialogName
                        titleTexts = @($titleTexts)
                        isOffscreen = $offscreen
                        isEnabled = $enabled
                        hasDocumentAncestor = $hasDocumentAncestor
                        processId = [int]$process.Id
                        className = $button.Current.ClassName
                        automationId = $button.Current.AutomationId
                        runtimeId = $runtimeId
                        boundingRect = $rectText
                        dialogKey = $dialogKey
                        element = $button
                    }) | Out-Null
                } catch [System.UnauthorizedAccessException] {
                    $script:permissionIssues = $script:permissionIssues + 1
                } catch {
                    # The element disappeared between FindAll and inspection.
                }
            }
        }
    }

    return @($candidates)
}

function Invoke-AllowCandidate {
    param($Candidate)
    $firstError = ''
    try {
        $invokePattern = $Candidate.element.GetCurrentPattern(
            [System.Windows.Automation.InvokePattern]::Pattern)
        $invokePattern.Invoke()
        return [pscustomobject]@{ ok = $true; method = 'invoke'; message = '' }
    } catch {
        $firstError = $_.Exception.Message
    }

    try {
        $legacyPattern = $Candidate.element.GetCurrentPattern(
            [System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
        $legacyPattern.DoDefaultAction()
        return [pscustomobject]@{ ok = $true; method = 'legacy-ia2'; message = '' }
    } catch {
        return [pscustomobject]@{
            ok = $false
            method = ''
            message = $firstError
            fallback = $_.Exception.Message
        }
    }
}

function Write-StateChange {
    param([string]$State, [hashtable]$Data)
    if ($script:lastState -eq $State) { return }
    $script:lastState = $State
    $eventData = @{ event = $State }
    if ($null -ne $Data) {
        foreach ($key in $Data.Keys) { $eventData[$key] = $Data[$key] }
    }
    Write-Event $eventData
}

function Get-WindowSummary {
    param($ChromeProcesses)
    $summary = @()
    foreach ($process in $ChromeProcesses) {
        $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
            [int]$process.Id)
        try {
            $windows = $rootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
            foreach ($window in $windows) {
                try {
                    $summary += [pscustomobject]@{
                        processId = [int]$process.Id
                        name = $window.Current.Name
                        className = $window.Current.ClassName
                    }
                } catch { }
            }
        } catch [System.UnauthorizedAccessException] {
            $script:permissionIssues = $script:permissionIssues + 1
        } catch { }
    }
    return @($summary)
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
Write-Event @{
    event = 'start'
    mode = $(if ($probe) { 'probe' } elseif ($follow) { 'follow' } else { 'once' })
    timeoutMs = $timeoutMs
    intervalMs = $intervalMs
    dryRun = $dryRun
    processNames = $processNames
    buttonNames = $buttonNames
    titlePatterns = $titlePatterns
    uia = 'available'
}

$startTime = Get-Date

if ($probe) {
    $processes = @(Get-ChromeProcesses)
    $candidates = @()
    if ($processes.Count -gt 0) {
        $candidates = @(Get-AllowCandidates $processes)
    }
    $selection = Select-AllowCandidate -Candidates $candidates -TitlePatterns $titlePatterns
    Write-Event @{
        event = 'probe'
        uiaAvailable = $true
        chromeRunning = ($processes.Count -gt 0)
        chromeProcessCount = $processes.Count
        chromeProcesses = @($processes | ForEach-Object { @{ pid = $_.Id; name = $_.ProcessName } })
        windows = @(Get-WindowSummary $processes)
        candidates = @($candidates | ForEach-Object { Get-PublicCandidate $_ })
        selected = $(if ($null -ne $selection.selected) { Get-PublicCandidate $selection.selected } else { $null })
        reason = $selection.reason
        permissionIssues = $script:permissionIssues
    }
    exit 0
}

$clickedKeys = @{}

while ($true) {
    $elapsed = ((Get-Date) - $startTime).TotalMilliseconds
    $script:permissionIssues = 0

    $processes = @(Get-ChromeProcesses)
    if ($processes.Count -eq 0) {
        if ($follow) {
            Write-StateChange 'no_chrome' @{ chromeProcessCount = 0 }
            Start-Sleep -Milliseconds $intervalMs
            continue
        }
        Write-Event @{ event = 'no_chrome'; chromeProcessCount = 0 }
        exit 2
    }

    Write-StateChange 'chrome_running' @{ chromeProcessCount = $processes.Count }

    $candidates = @(Get-AllowCandidates $processes)
    $selection = Select-AllowCandidate -Candidates $candidates -TitlePatterns $titlePatterns

    if ($null -ne $selection.selected) {
        $selected = $selection.selected
        $publicCandidate = Get-PublicCandidate $selected

        if ($dryRun) {
            $shouldEmit = $true
            if ($follow) {
                $now = Get-Date
                $sameDialog = ($script:lastWouldClickKey -eq $selected.dialogKey)
                $recent = (($now - $script:lastWouldClickAt).TotalMilliseconds -lt $clickCooldownMs)
                $shouldEmit = -not ($sameDialog -and $recent)
                if ($shouldEmit) {
                    $script:lastWouldClickKey = $selected.dialogKey
                    $script:lastWouldClickAt = $now
                }
            }
            if ($shouldEmit) {
                Write-Event @{
                    event = 'would_click'
                    candidate = $publicCandidate
                    candidates = @($selection.strongCandidates | ForEach-Object { Get-PublicCandidate $_ })
                    elapsedMs = [int]$elapsed
                }
            }
            if (-not $follow) { exit 0 }
            Start-Sleep -Milliseconds $intervalMs
            continue
        }

        $record = $clickedKeys[$selected.dialogKey]
        $now = Get-Date
        if ($null -ne $record) {
            $age = ($now - $record.last).TotalMilliseconds
            if ($record.count -ge $maxClicks -and $age -lt $clickResetMs) {
                Write-Event @{
                    event = 'click_limit'
                    candidate = $publicCandidate
                    count = $record.count
                    message = 'The dialog is still present after repeated clicks; skipping it until the cooldown expires.'
                }
                Start-Sleep -Milliseconds $intervalMs
                continue
            }
            if ($age -ge $clickResetMs) { $record = $null }
        }

        $invoke = Invoke-AllowCandidate $selected
        if ($invoke.ok) {
            if ($null -eq $record) { $record = @{ count = 0; last = $now } }
            $record.count = $record.count + 1
            $record.last = Get-Date
            $clickedKeys[$selected.dialogKey] = $record

            Write-Event @{
                event = 'clicked'
                candidate = $publicCandidate
                method = $invoke.method
                elapsedMs = [int]$elapsed
            }
            if (-not $follow) { exit 0 }
            Start-Sleep -Milliseconds $clickCooldownMs
            continue
        }

        Write-Event @{
            event = 'error'
            code = 'invoke_failed'
            message = 'Found the Allow button but could not invoke it.'
            candidate = $publicCandidate
            detail = $invoke.message
            fallbackDetail = $invoke.fallback
        }
        if (-not $follow) { exit 3 }
        Start-Sleep -Milliseconds $intervalMs
        continue
    }

    if ($script:permissionIssues -gt 0) {
        if (-not $follow) {
            Write-Event @{
                event = 'permission_denied'
                code = 'uia_access_denied'
                message = 'Windows UI Automation could not read one or more Chrome windows.'
                hint = 'Run the terminal at the same elevation as Chrome, or close the elevated Chrome instance.'
            }
            exit 3
        }
        if (-not $script:permissionReported) {
            $script:permissionReported = $true
            Write-Event @{
                event = 'permission_denied'
                code = 'uia_access_denied'
                message = 'Windows UI Automation could not read one or more Chrome windows.'
                hint = 'Run the terminal at the same elevation as Chrome, or close the elevated Chrome instance.'
            }
        }
    } else {
        $script:permissionReported = $false
    }

    if ($debug) {
        Write-Event @{
            event = 'tick'
            elapsedMs = [int]$elapsed
            chromeProcessCount = $processes.Count
            candidateCount = $candidates.Count
            reason = $selection.reason
        }
    }

    if (-not $follow -and $elapsed -ge $timeoutMs) {
        Write-Event @{ event = 'timeout'; elapsedMs = [int]$elapsed }
        exit 1
    }

    Start-Sleep -Milliseconds $intervalMs
}