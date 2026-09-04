$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Import-DotEnvFile {
  param([Parameter(Mandatory)][string] $Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      continue
    }

    $name = $matches[1]
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

function Read-SupabaseEnvironment {
  $lines = & cmd.exe /d /s /c 'pnpm exec supabase status -o env 2>nul'
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Starting local Supabase...'
    & cmd.exe /d /s /c 'pnpm exec supabase start 2>&1'
    if ($LASTEXITCODE -ne 0) {
      throw 'Local Supabase failed to start. Make sure Docker Desktop is running.'
    }
    $lines = & cmd.exe /d /s /c 'pnpm exec supabase status -o env 2>nul'
  }

  $values = @{}
  foreach ($line in $lines) {
    if ($line -match '^([^=]+)="?(.*?)"?$') {
      $values[$matches[1]] = $matches[2].TrimEnd('"')
    }
  }

  foreach ($required in @('API_URL', 'SERVICE_ROLE_KEY', 'DB_URL')) {
    if ([string]::IsNullOrWhiteSpace($values[$required])) {
      throw "Local Supabase did not provide $required."
    }
  }

  return $values
}

Import-DotEnvFile -Path (Join-Path $projectRoot '.env.local')
$supabase = Read-SupabaseEnvironment

$env:SUPABASE_URL = $supabase['API_URL']
$env:SUPABASE_SERVICE_ROLE_KEY = $supabase['SERVICE_ROLE_KEY']
$env:TEST_DATABASE_URL = $supabase['DB_URL']
$env:NORMALIZATION_WRITER_RELEASE_SHA = '13b51161a28f3fbef7a193f13c4fe8bb35c0f21f'

Write-Host 'Amazon Research Agent starting:'
Write-Host '  Web:    http://127.0.0.1:3100/ko'
Write-Host '  Worker: local queue consumer'
Write-Host 'Press Ctrl+C to stop both processes.'

& pnpm --parallel --stream --filter @ara/web --filter @ara/worker run dev:local
exit $LASTEXITCODE
