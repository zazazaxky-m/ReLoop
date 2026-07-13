$file = "d:\ReLoop\mobile\coverage\lcov.info"
$content = Get-Content $file -Raw
$blocks = $content -split "end_of_record"
$targetPath = $args[0]
foreach ($block in $blocks) {
    if ($block -notmatch "SF:.*$([regex]::Escape($targetPath))") { continue }
    $lines = $block -split "`n"
    Write-Host "=== Uncovered lines in $targetPath ==="
    foreach ($line in $lines) {
        if ($line -match "^DA:(\d+),0$") {
            Write-Host "  Line $($Matches[1])"
        }
    }
}
