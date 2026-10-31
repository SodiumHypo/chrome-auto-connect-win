param(
    [Parameter(Mandatory = $true)]
    [string]$CasesFile,
    [Parameter(Mandatory = $true)]
    [string]$MatcherPath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

. $MatcherPath

$data = Get-Content -LiteralPath $CasesFile -Raw -Encoding UTF8 | ConvertFrom-Json

$total = 0
$passed = 0
$failures = New-Object System.Collections.ArrayList

function Add-Failure {
    param([string]$Label, [string]$Expected, [string]$Actual)
    $failures.Add([pscustomobject]@{
        case = $Label
        expected = $Expected
        actual = $Actual
    }) | Out-Null
}

foreach ($case in @($data.button)) {
    $total = $total + 1
    $actual = Test-ButtonName ([string]$case.name) @($case.allowed)
    if ($actual -eq [bool]$case.expected) {
        $passed = $passed + 1
    } else {
        Add-Failure ('button:' + $case.name) ([string]$case.expected) ([string]$actual)
    }
}

foreach ($case in @($data.title)) {
    $total = $total + 1
    $actual = Test-TitleText ([string]$case.text) @($case.patterns)
    if ($actual -eq [bool]$case.expected) {
        $passed = $passed + 1
    } else {
        Add-Failure ('title:' + $case.text) ([string]$case.expected) ([string]$actual)
    }
}

foreach ($case in @($data.selection)) {
    $total = $total + 1
    $selection = Select-AllowCandidate -Candidates @($case.candidates) -TitlePatterns @($case.titlePatterns)
    $actualName = $null
    if ($null -ne $selection.selected) {
        $actualName = [string]$selection.selected.dialogName
    }
    $expectedName = $null
    if ($null -ne $case.expectedSelected) {
        $expectedName = [string]$case.expectedSelected
    }
    $nameOk = ($actualName -eq $expectedName)
    $reasonOk = ([string]$selection.reason -eq [string]$case.expectedReason)
    if ($nameOk -and $reasonOk) {
        $passed = $passed + 1
    } else {
        Add-Failure ('selection:' + $case.name) `
            ('selected=' + [string]$expectedName + ';reason=' + [string]$case.expectedReason) `
            ('selected=' + [string]$actualName + ';reason=' + [string]$selection.reason)
    }
}

$output = [pscustomobject]@{
    ok = ($failures.Count -eq 0)
    total = $total
    passed = $passed
    failures = @($failures)
}
[Console]::Out.WriteLine(($output | ConvertTo-Json -Depth 6 -Compress))

if ($failures.Count -gt 0) { exit 1 }
exit 0