param([switch] $CheckOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Import-DotEnvFile {
  param(
    [Parameter(Mandatory)][string] $Path,
    [Parameter(Mandatory)][System.Collections.Generic.HashSet[string]] $AllowedNames
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Missing private environment file: $Path"
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      continue
    }
    $name = $matches[1]
    if (-not $AllowedNames.Contains($name)) {
      continue
    }
    $value = $matches[2].Trim()
    if (
      $value.Length -ge 2 -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or
       ($value.StartsWith("'") -and $value.EndsWith("'")))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

$workerEnvironmentNames = [System.Collections.Generic.HashSet[string]]::new(
  [string[]] @(
    'APP_SECRET_ENCRYPTION_KEY_B64',
    'JUNGLE_SCOUT_KEY_NAME',
    'JUNGLE_SCOUT_API_KEY',
    'JUNGLE_SCOUT_BASE_URL',
    'JUNGLE_SCOUT_DAILY_LIMIT',
    'JUNGLE_SCOUT_RESERVED_LIMIT',
    'TELEGRAM_BOT_TOKEN',
    'WORKER_ID'
  ),
  [System.StringComparer]::Ordinal
)
$runtimeEnvironmentNames = @(
  'ALLUSERSPROFILE', 'APPDATA', 'ComSpec', 'HOMEDRIVE', 'HOMEPATH',
  'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS', 'OS', 'Path', 'PATHEXT',
  'PROCESSOR_ARCHITECTURE', 'ProgramData', 'ProgramFiles',
  'ProgramFiles(x86)', 'ProgramW6432', 'PSModulePath', 'SystemDrive',
  'SystemRoot', 'TEMP', 'TMP', 'USERDOMAIN', 'USERNAME', 'USERPROFILE', 'windir'
)
$runtimeEnvironment = @{}
foreach ($name in $runtimeEnvironmentNames) {
  $value = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ($null -ne $value) {
    $runtimeEnvironment[$name] = $value
  }
}
Get-ChildItem Env: | ForEach-Object {
  [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process')
}
foreach ($entry in $runtimeEnvironment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
}
$env:NODE_ENV = 'production'
Import-DotEnvFile `
  -Path (Join-Path $projectRoot '.env.local') `
  -AllowedNames $workerEnvironmentNames

$projectRefPath = Join-Path $projectRoot 'supabase/.temp/project-ref'
if (-not (Test-Path -LiteralPath $projectRefPath -PathType Leaf)) {
  throw 'This checkout is not linked to Supabase. Run supabase link first.'
}
$projectRef = (Get-Content -Raw -LiteralPath $projectRefPath).Trim()
if ($projectRef -notmatch '^[a-z]{20}$') {
  throw 'The linked Supabase project reference is invalid.'
}

$rawKeys = & cmd.exe /d /s /c (
  "pnpm exec supabase projects api-keys --project-ref $projectRef --reveal --output json 2>nul"
)
if ($LASTEXITCODE -ne 0) {
  throw 'Could not read the linked Supabase service-role key.'
}
$serviceRoleKey = (($rawKeys | ConvertFrom-Json) |
  Where-Object { $_.name -eq 'service_role' -and $_.type -eq 'legacy' } |
  Select-Object -First 1).api_key
if ([string]::IsNullOrWhiteSpace($serviceRoleKey)) {
  throw 'The linked Supabase project did not return a service-role key.'
}
if ([string]::IsNullOrWhiteSpace($env:APP_SECRET_ENCRYPTION_KEY_B64)) {
  throw 'APP_SECRET_ENCRYPTION_KEY_B64 is required in .env.local.'
}

$env:SUPABASE_URL = "https://$projectRef.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = $serviceRoleKey
$env:NORMALIZATION_WRITER_RELEASE_SHA = '13b51161a28f3fbef7a193f13c4fe8bb35c0f21f'

$headers = @{
  apikey = $serviceRoleKey
  Authorization = "Bearer $serviceRoleKey"
}
$capabilityRequest = @{
  Method = 'Post'
  Uri = "$($env:SUPABASE_URL)/rest/v1/rpc/read_normalization_writer_capability"
  Headers = $headers
  ContentType = 'application/json'
  Body = '{}'
}
$capability = @(Invoke-RestMethod @capabilityRequest)
if (
  $capability.Count -ne 1 -or
  $capability[0].mode -ne 'canonical' -or
  $capability[0].migration_identity -ne '202608290022'
) {
  throw 'Remote Supabase does not expose the required canonical writer capability.'
}

if ($CheckOnly) {
  Write-Host 'Production worker preflight passed: remote canonical queue is ready.'
  exit 0
}

Write-Host 'Production worker starting against the linked remote Supabase project.'
Write-Host 'Press Ctrl+C to stop it.'
& pnpm --filter @ara/worker start
exit $LASTEXITCODE
