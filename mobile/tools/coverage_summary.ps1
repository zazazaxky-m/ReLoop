$file = "d:\ReLoop\mobile\coverage\lcov.info"
$content = Get-Content $file -Raw
$blocks = $content -split "end_of_record"
$results = @()
foreach ($block in $blocks) {
    if ($block -notmatch "SF:") { continue }
    $lines = $block -split "`n"
    $filePath = $null
    $lf = 0
    $lh = 0
    foreach ($line in $lines) {
        if ($line -match "^SF:(.+)$") { $filePath = $Matches[1] }
        elseif ($line -match "^LF:(\d+)$") { $lf = [int]$Matches[1] }
        elseif ($line -match "^LH:(\d+)$") { $lh = [int]$Matches[1] }
    }
    $pct = if ($lf -gt 0) { [math]::Round(($lh / $lf) * 100, 2) } else { 100.0 }
    $results += [PSCustomObject]@{
        File = $filePath
        LF = $lf
        LH = $lh
        Uncovered = $lf - $lh
        Pct = $pct
    }
}
$totalLF = ($results | Measure-Object -Property LF -Sum).Sum
$totalLH = ($results | Measure-Object -Property LH -Sum).Sum
$totalPct = [math]::Round(($totalLH / $totalLF) * 100, 2)
Write-Host "TOTAL: $totalLH / $totalLF = $totalPct%"
Write-Host ""
Write-Host "Files with uncovered lines (sorted by Pct ascending):"
$results | Where-Object { $_.Uncovered -gt 0 } | Sort-Object Pct | ForEach-Object {
    Write-Host ("  {0,6:0.00}%  LF={1,5} LH={2,5} Uncov={3,4}  {4}" -f $_.Pct, $_.LF, $_.LH, $_.Uncovered, $_.File)
}
