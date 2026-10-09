# Builds dist/token-dashboard.exe with Node.js Single Executable Applications (SEA).
# Usage: powershell -ExecutionPolicy Bypass -File build\build.ps1   (or run build.bat)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'   # SEA sentinel fuse (Node.js docs)
$Postject = 'postject@1.0.0-alpha.6'
$Dist = Join-Path $Root 'dist'
$Exe = Join-Path $Dist 'token-dashboard.exe'
$Blob = Join-Path $Dist 'sea-prep.blob'

function Invoke-Checked([string]$What, [scriptblock]$Cmd) {
    & $Cmd
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)" }
}

Write-Host '[1/6] Regenerating build/sea-config.json assets from public/ (recursive: includes public/skins/)'
$assets = [ordered]@{}
$PublicDir = Join-Path $Root 'public'
Get-ChildItem -Path $PublicDir -File -Recurse | ForEach-Object {
    $_.FullName.Substring($PublicDir.Length + 1).Replace('\', '/')
} | Sort-Object | ForEach-Object {
    $assets["public/$_"] = "public/$_"
}
$cfg = [ordered]@{
    main = 'dist/bundle.cjs'
    output = 'dist/sea-prep.blob'
    disableExperimentalSEAWarning = $true
    useCodeCache = $false
    assets = $assets
}
$json = $cfg | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $Root 'build\sea-config.json'), $json + "`n", (New-Object System.Text.UTF8Encoding($false)))

Write-Host '[2/6] Bundling server.js and lib/*.js into dist/bundle.cjs'
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
Invoke-Checked 'bundler' { node build/bundle.js }

Write-Host '[3/6] Generating SEA preparation blob'
Invoke-Checked 'sea blob generation' { node --experimental-sea-config build/sea-config.json }

Write-Host '[4/6] Copying node.exe to dist/token-dashboard.exe'
$NodeExe = (node -p 'process.execPath').Trim()
Copy-Item -Force -Path $NodeExe -Destination $Exe

Write-Host '[5/6] Removing Authenticode signature (if signtool is available)'
$signtool = Get-Command signtool -ErrorAction SilentlyContinue
if ($signtool) {
    Invoke-Checked 'signtool remove' { & $signtool.Source remove /s $Exe }
} else {
    Write-Host '      signtool not found; skipping (postject may still work on the unsigned copy)'
}

Write-Host '[6/6] Injecting the blob with postject'
Invoke-Checked 'postject' { npx.cmd --yes $Postject $Exe NODE_SEA_BLOB $Blob --sentinel-fuse $Fuse }

$size = [math]::Round((Get-Item $Exe).Length / 1MB, 1)
Write-Host "Built $Exe ($size MB)"
