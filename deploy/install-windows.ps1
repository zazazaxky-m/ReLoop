param(
  [string]$Python = "python",
  [string]$Config = "$PSScriptRoot\..\rvm\config.local.json"
)

$root = Resolve-Path "$PSScriptRoot\.."
if (-not (Test-Path $Config)) {
  Copy-Item "$root\rvm\config.example.json" $Config
  Write-Host "Edit config terlebih dahulu: $Config"
  exit 1
}

$taskName = "ReLoop RVM Edge"
$action = New-ScheduledTaskAction -Execute $Python -Argument "-m rvm.main --config `"$Config`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force
Write-Host "Scheduled task installed: $taskName"
