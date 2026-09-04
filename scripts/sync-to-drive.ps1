# Mirror the working repo (C:) into Google Drive for backup/access, WITHOUT the
# folders that break Drive sync (node_modules) or are regenerated (dist, coverage).
# The Drive copy is a mirror only — always develop in the C:\ repo.
$ErrorActionPreference = 'Stop'
$src = 'C:\Projects\tarneeb-trix'
$dst = 'G:\My Drive\Projects\Card Game app\tarneeb-trix'

robocopy $src $dst /MIR `
  /XD node_modules dist coverage .git .vscode .idea `
  /XF *.tsbuildinfo *.log `
  /NFL /NDL /NP /R:2 /W:2 | Out-Null

$code = $LASTEXITCODE
if ($code -ge 8) { Write-Error "robocopy failed with code $code" }
else { Write-Host "Synced C: -> Drive (robocopy code ${code}; 0=no change, 1=files copied)" }
