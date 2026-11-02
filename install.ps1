# RSA Studio installer for Windows PowerShell 5.1+ (free, no admin needed except for Node.js install)
$ErrorActionPreference = "Stop"
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---- GitHub zip link of the app (already set) ----
$ZipUrl = "https://github.com/monirppc/rsa-studio/archive/refs/heads/main.zip"
# --------------------------------------------------------------------

$AppName    = "RSA Studio"
$InstallDir = Join-Path $env:LOCALAPPDATA "RSA-Studio"

function Say($m, $c = "Cyan") { Write-Host $m -ForegroundColor $c }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
function Node-Ok {
  try { $v = (& node --version) 2>$null; if ($v -match "v(\d+)") { return ([int]$Matches[1] -ge 18) } } catch {}
  return $false
}

try {
  Say "`n=== $AppName installer ===`n"
  if ($ZipUrl -like "*YOUR-GITHUB-NAME*") { throw "Open install.ps1 and put your GitHub name in the `$ZipUrl line first." }

  # 1) Node.js
  if (-not (Node-Ok)) {
    Say "Node.js 18 or newer not found. Installing Node.js LTS (free)..." "Yellow"
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
      Refresh-Path
    }
    if (-not (Node-Ok)) {
      Start-Process "https://nodejs.org"
      throw "Please install Node.js LTS from https://nodejs.org (the page just opened), then run this install command again."
    }
  }
  Say ("Node.js OK: " + (& node --version)) "Green"

  # 2) Download the app
  $tmp = Join-Path $env:TEMP ("rsa-studio-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp "app.zip"
  Say "Downloading the app..."
  Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp "x") -Force
  $server = Get-ChildItem -Path (Join-Path $tmp "x") -Recurse -Filter server.js |
            Where-Object { $_.FullName -notmatch "node_modules" } | Select-Object -First 1
  if (-not $server) { throw "server.js was not found in the download. Check the ZipUrl line." }
  $src = $server.DirectoryName

  # 3) Copy files (keeps the user's own .env on updates)
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Get-ChildItem -Path $src -Force |
    Where-Object { @(".env", "node_modules", ".git", ".github", ".gitignore", "install.ps1") -notcontains $_.Name } |
    Copy-Item -Destination $InstallDir -Recurse -Force

  # 4) Browser helper (Playwright)
  Push-Location $InstallDir
  if (-not (Test-Path "package.json")) { npm.cmd init -y | Out-Null }
  Say "Installing the browser helper (Playwright)..."
  npm.cmd install playwright --no-fund --no-audit --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw "npm install failed. Check your internet and run the command again." }
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
              "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
              "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $chrome) {
    Say "Google Chrome not found. Downloading a browser for the app (about 150 MB)..." "Yellow"
    npx.cmd playwright install chromium
  }
  Pop-Location

  # 5) Settings file with the user's OWN free Gemini key
  $envFile = Join-Path $InstallDir ".env"
  if (-not (Test-Path $envFile)) {
    Say "`nYou need your own FREE Gemini key." "Yellow"
    Say "A page is opening: click 'Create API key', copy the key, then paste it here."
    Start-Process "https://aistudio.google.com/apikey"
    $key = (Read-Host "Paste your key and press Enter").Trim()
    $lines = @("PROVIDER=gemini", "GEMINI_API_KEY=$key", "GEMINI_MODEL=gemini-3.8-flash", "MIN_GAP_MS=4500", "PORT=3000")
    [IO.File]::WriteAllLines($envFile, $lines)
    if (-not $key) { Say "No key entered. Later, open $envFile in Notepad and paste it after GEMINI_API_KEY=" "Yellow" }
  } else {
    Say "Existing settings kept (.env)." "Green"
  }

  # 6) Launcher + desktop shortcut
  $cmd = Join-Path $InstallDir "RSA-Studio.cmd"
  [IO.File]::WriteAllLines($cmd, @("@echo off", "cd /d ""%~dp0""", "title RSA Studio - keep this window open", "node server.js", "pause"))
  $desk = [Environment]::GetFolderPath("Desktop")
  $ws   = New-Object -ComObject WScript.Shell
  $lnk  = $ws.CreateShortcut((Join-Path $desk "RSA Studio.lnk"))
  $lnk.TargetPath = $cmd
  $lnk.WorkingDirectory = $InstallDir
  $lnk.Description = "RSA Studio - Google Ads build sheets"
  $ico = Join-Path $InstallDir "public\RSA-Studio.ico"
  if (Test-Path $ico) { $lnk.IconLocation = "$ico,0" }
  $lnk.Save()

  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Say "`nDone. Use the 'RSA Studio' icon on your Desktop. Keep the black window open while you use the app." "Green"
  $a = Read-Host "Open RSA Studio now? (Y/N)"
  if ($a -match "^[Yy]") { Start-Process $cmd }
}
catch {
  Say ("`nSomething went wrong: " + $_.Exception.Message) "Red"
  Say "Take a screenshot of this window and send it to the person who shared the app." "Yellow"
}
