param(
  [string]$Config = "$PSScriptRoot\..\rvm\config.local.json",
  [int]$LocalPort = 8765,
  [switch]$BrowserOnly
)

$repo = Resolve-Path "$PSScriptRoot\.."
$localUrl = "http://127.0.0.1:$LocalPort"

if (-not $BrowserOnly) {
  if (-not (Test-Path $Config)) {
    throw "Config tidak ditemukan: $Config. Salin rvm/config.example.json terlebih dahulu."
  }
  $ready = $false
  try {
    $null = Invoke-RestMethod "$localUrl/api/health" -TimeoutSec 1
    $ready = $true
  } catch {}
  if (-not $ready) {
    $python = (Get-Command python -ErrorAction Stop).Source
    Start-Process -FilePath $python -WorkingDirectory $repo -WindowStyle Hidden -ArgumentList @(
      "-m", "rvm.main", "--config", $Config
    )
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Milliseconds 250
      try {
        $null = Invoke-RestMethod "$localUrl/api/health" -TimeoutSec 1
        break
      } catch {}
    }
  }
}

$candidates = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "Chrome/Edge tidak ditemukan." }

Start-Process -FilePath $browser -ArgumentList @(
  "--kiosk",
  "--app=$localUrl",
  "--no-first-run",
  "--disable-session-crashed-bubble",
  "--disable-infobars",
  "--autoplay-policy=no-user-gesture-required",
  "--overscroll-history-navigation=0",
  "--disable-pinch"
)
