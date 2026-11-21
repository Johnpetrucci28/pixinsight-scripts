# Regénère downloads/<Script>.zip à partir de chaque dossier scripts/<Script>/.
# À lancer après chaque modification d'un script, avant de pousser sur GitHub :
#   powershell -ExecutionPolicy Bypass -File tools\build-zips.ps1
$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root "scripts"
$out  = Join-Path $root "downloads"
New-Item -ItemType Directory -Force $out | Out-Null

Get-ChildItem $src -Directory | ForEach-Object {
    $zip = Join-Path $out ($_.Name + ".zip")
    if (Test-Path $zip) { Remove-Item $zip -Force }
    # Le zip contient le dossier lui-même (ex. SpectralStarMix/SpectralStarMix.js)
    Compress-Archive -Path $_.FullName -DestinationPath $zip
    Write-Host ("{0,-24} {1,8:N0} octets" -f $_.Name, (Get-Item $zip).Length)
}
