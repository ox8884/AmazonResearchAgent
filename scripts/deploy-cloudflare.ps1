$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$ubuntu = (& wsl.exe --list --quiet) -replace "`0", ''
if (-not ($ubuntu -contains 'Ubuntu')) {
  throw 'The Ubuntu WSL distribution is required for a reliable OpenNext build on Windows.'
}
if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
  throw 'CLOUDFLARE_API_TOKEN is required in the current process.'
}

$wslProjectRoot = (& wsl.exe -d Ubuntu -e wslpath -a $projectRoot).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($wslProjectRoot)) {
  throw 'Could not map the project directory into Ubuntu WSL.'
}

Write-Host 'Building and deploying the Cloudflare Worker in Ubuntu WSL...'
$wslScript = "$wslProjectRoot/scripts/deploy-cloudflare.sh"
$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = 'wsl.exe'
$startInfo.Arguments = "-d Ubuntu -e sh `"$wslScript`" `"$wslProjectRoot`""
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardInput = $true
$process = [Diagnostics.Process]::Start($startInfo)
$tokenBytes = [Text.UTF8Encoding]::new($false).GetBytes(
  $env:CLOUDFLARE_API_TOKEN + "`n"
)
$process.StandardInput.BaseStream.Write($tokenBytes, 0, $tokenBytes.Length)
$process.StandardInput.Close()
$process.WaitForExit()

if ($process.ExitCode -ne 0) {
  exit $process.ExitCode
}
