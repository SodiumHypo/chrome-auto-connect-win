# uia-matcher.ps1
# Pure matching / selection logic. Kept ASCII-only so Windows PowerShell 5.1
# can parse it regardless of the system code page. Localized strings are
# supplied by the JSON configuration file (UTF-8).

function ConvertTo-NormalizedText {
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    $value = $Text.Normalize([System.Text.NormalizationForm]::FormKC)
    $value = $value -replace '&', ''
    $value = $value -replace '\s+', ' '
    return $value.Trim().ToLowerInvariant()
}

function Test-ButtonName {
    param(
        [string]$Name,
        [string[]]$AllowedNames
    )
    $normalized = ConvertTo-NormalizedText $Name
    if ([string]::IsNullOrWhiteSpace($normalized)) { return $false }
    if ($null -eq $AllowedNames) { return $false }
    foreach ($allowed in $AllowedNames) {
        if ($normalized -eq (ConvertTo-NormalizedText $allowed)) { return $true }
    }
    return $false
}

function Test-TitleText {
    param(
        [string]$Text,
        [string[]]$Patterns
    )
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    if ($null -eq $Patterns) { return $false }
    $normalized = ConvertTo-NormalizedText $Text
    foreach ($pattern in $Patterns) {
        $needle = ConvertTo-NormalizedText $pattern
        if (-not [string]::IsNullOrWhiteSpace($needle) -and $normalized.Contains($needle)) {
            return $true
        }
    }
    return $false
}

function Select-AllowCandidate {
    param(
        [object[]]$Candidates,
        [string[]]$TitlePatterns
    )

    $eligible = @()
    foreach ($candidate in @($Candidates)) {
        if ($null -eq $candidate) { continue }
        if ($candidate.isOffscreen -eq $true) { continue }
        if ($candidate.isEnabled -eq $false) { continue }
        if ($candidate.hasDocumentAncestor -eq $true) { continue }
        $eligible += $candidate
    }

    $strong = @()
    foreach ($candidate in $eligible) {
        $titleHit = Test-TitleText $candidate.dialogName $TitlePatterns
        if (-not $titleHit) {
            foreach ($text in @($candidate.titleTexts)) {
                if (Test-TitleText $text $TitlePatterns) {
                    $titleHit = $true
                    break
                }
            }
        }
        if ($titleHit) { $strong += $candidate }
    }

    if ($strong.Count -gt 0) {
        return [pscustomobject]@{
            selected = $strong[0]
            candidates = $eligible
            strongCandidates = $strong
            reason = 'title_match'
        }
    }

    return [pscustomobject]@{
        selected = $null
        candidates = $eligible
        strongCandidates = @()
        reason = $(if ($eligible.Count -gt 0) { 'title_mismatch' } else { 'no_candidates' })
    }
}