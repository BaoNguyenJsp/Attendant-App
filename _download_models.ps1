# Download face-api.js model files to public/models/
# Run once: powershell -ExecutionPolicy Bypass -File _download_models.ps1

$ErrorActionPreference = 'Stop'
$base = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'
$dest = Join-Path $PSScriptRoot 'public\models'

if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null }

$files = @(
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2'
)

foreach ($f in $files) {
  $out = Join-Path $dest $f
  if (Test-Path $out) { Write-Host "[skip] $f (exists)"; continue }
  Write-Host "[get ] $f"
  Invoke-WebRequest -Uri "$base/$f" -OutFile $out -UseBasicParsing
}

Write-Host "`nDone. Files in $dest :"
Get-ChildItem $dest | Format-Table Name, Length -AutoSize
