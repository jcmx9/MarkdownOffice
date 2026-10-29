<#
.SYNOPSIS
  End-to-end check of scripts\bootstrap.ps1 against a locally built archive (CI job "bootstrap").
.DESCRIPTION
  scripts\test-bootstrap.ps1 [-Archive dist\markdown-office-<version>-win-x64.zip]

  Runs under Windows PowerShell 5.1 and starts the bootstrap as a separate
  powershell.exe process: as a file, and in the documented one-liner forms ("irm | iex"
  and the script block with -Uninstall), fed from the local file instead of irm.
  LOCALAPPDATA, APPDATA and MDO_HOME point into a temp folder, so the real profile,
  WindowsApps folder and Start menu are never touched; MDO_CLASSES_KEY moves the
  Explorer verb "Markdown-PDF" below a temporary HKCU\Software\MarkdownOffice-test-<id>
  key, whose command line the test runs like Explorer would. The download path runs against
  fake Invoke-RestMethod / Invoke-WebRequest functions (they shadow the cmdlets), so no
  network is needed.
#>
param([string]$Archive = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$bootstrap = Join-Path $root 'scripts\bootstrap.ps1'
$version = (Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json).version
$typstVersion = (Get-Content -Raw -LiteralPath (Join-Path $root 'scripts\pipeline-assets.json') | ConvertFrom-Json).typst.version
if (-not $Archive) { $Archive = Join-Path $root "dist\markdown-office-$version-win-x64.zip" }
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw "archive not found: $Archive" }
$Archive = (Resolve-Path -LiteralPath $Archive).Path

function Fail([string]$Message) {
  Write-Host "FAIL: $Message" -ForegroundColor Red
  exit 1
}
function Pass([string]$Message) { Write-Host "ok   $Message" }

$work = Join-Path ([IO.Path]::GetTempPath()) ('mdo-bootstrap-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$regRoot = ''

try {
  $env:LOCALAPPDATA = Join-Path $work 'Local'
  $env:APPDATA = Join-Path $work 'Roaming'
  New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA, $env:APPDATA | Out-Null
  # Below LOCALAPPDATA, like the default location, so the command uses %LOCALAPPDATA%; with a
  # space, like the default "Markdown Office", so every path in the command must stay quoted.
  $env:MDO_HOME = Join-Path $env:LOCALAPPDATA 'mdo home'
  # The PDF viewer must not open during the conversion check.
  $env:MDO_NO_OPEN = '1'

  $installDir = $env:MDO_HOME
  $exe = Join-Path $installDir 'Markdown Office.exe'
  $oldDir = $installDir + '.old'
  $marker = Join-Path $installDir '.mdo-install'
  $cmdPath = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\markdown-office.cmd'
  $shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Markdown Office.lnk'
  # The Explorer verb "Markdown-PDF" goes below a test key instead of HKCU\Software\Classes, so
  # a local run never changes the real context menu; uninstall must remove the whole test key
  # again (every key the install created).
  $regRoot = 'Software\MarkdownOffice-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
  $env:MDO_CLASSES_KEY = "$regRoot\Classes"
  # The registration as a program for .md (Default apps list) goes below the same test root.
  $env:MDO_SOFTWARE_KEY = "$regRoot\Software"
  $progKey = "$env:MDO_CLASSES_KEY\MarkdownOffice.md"
  $capsKey = "$env:MDO_SOFTWARE_KEY\Markdown Office\Capabilities"
  $verbKeys = @('.md', '.markdown' | ForEach-Object { "$env:MDO_CLASSES_KEY\SystemFileAssociations\$_\shell\Markdown-PDF" })
  $pdfHelper = Join-Path $installDir 'markdown-pdf.js'
  $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $notifyLog = Join-Path $work 'notify.log'

  # --- Fake GitHub -----------------------------------------------------------
  $fake = Join-Path $work 'fake-gh'
  New-Item -ItemType Directory -Path $fake | Out-Null
  $env:FAKE_GH = $fake
  $fakeWeb = Join-Path $work 'fake-web.ps1'
  Set-Content -LiteralPath $fakeWeb -Encoding Ascii -Value @'
Add-Type -TypeDefinition @"
public class FakeHttpException : System.Exception {
  public FakeHttpException(string message) : base(message) {}
  public object Response { get; set; }
}
"@
function global:Get-FakeKey([string]$Uri) { Join-Path $env:FAKE_GH ($Uri -replace '[/:?=&]', '_') }
function global:Invoke-FakeFetch([string]$Uri) {
  $key = Get-FakeKey $Uri
  Add-Content -LiteralPath (Join-Path $env:FAKE_GH 'requests.log') -Value $Uri
  if (Test-Path -LiteralPath "$key.offline") {
    throw (New-Object System.Net.WebException 'Der Remotename konnte nicht aufgeloest werden: api.github.com')
  }
  $status = 200
  if (Test-Path -LiteralPath "$key.status") {
    $status = [int](Get-Content -LiteralPath "$key.status")
  } elseif (-not ((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath "$key.ref"))) {
    $status = 404
  }
  if ($status -ge 400) {
    $headers = @{}
    if (Test-Path -LiteralPath "$key.headers") {
      foreach ($line in Get-Content -LiteralPath "$key.headers") {
        $parts = $line -split ':\s*', 2
        if ($parts.Count -eq 2) { $headers[$parts[0]] = $parts[1] }
      }
    }
    $err = New-Object FakeHttpException "HTTP $status"
    $err.Response = [pscustomobject]@{ StatusCode = $status; Headers = $headers }
    throw $err
  }
  return $key
}
function global:Invoke-RestMethod {
  param([string]$Uri, $Headers, [switch]$UseBasicParsing)
  $key = Invoke-FakeFetch $Uri
  return (Get-Content -Raw -LiteralPath $key | ConvertFrom-Json)
}
function global:Invoke-WebRequest {
  param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
  $key = Invoke-FakeFetch $Uri
  if (Test-Path -LiteralPath "$key.ref") {
    Copy-Item -LiteralPath (Get-Content -LiteralPath "$key.ref") -Destination $OutFile
  } else {
    Copy-Item -LiteralPath $key -Destination $OutFile
  }
}
'@
  $api = 'https://api.github.com/repos/jcmx9/MarkdownOffice/releases'
  $download = 'https://github.com/jcmx9/MarkdownOffice/releases/download'
  function Get-FixturePath([string]$Uri) { Join-Path $fake ($Uri -replace '[/:?=&]', '_') }
  function New-ReleaseJson([string]$Tag, [string]$Prerelease, [string]$Draft) {
    $ver = $Tag.TrimStart('v')
    return ('{{"prerelease": {0}, "assets": [{{"name": "markdown-office-{1}-win-x64.zip", "browser_download_url": "{2}/{3}/markdown-office-{1}-win-x64.zip"}}, {{"name": "SHA256SUMS", "browser_download_url": "{2}/{3}/SHA256SUMS"}}], "draft": {4}, "tag_name": "{3}"}}' -f $Prerelease, $ver, $download, $Tag, $Draft)
  }
  function Publish-Assets([string]$Tag, [string]$Hash = '') {
    $ver = $Tag.TrimStart('v')
    $asset = "markdown-office-$ver-win-x64.zip"
    Set-Content -LiteralPath ((Get-FixturePath "$download/$Tag/$asset") + '.ref') -Value $Archive -Encoding Ascii
    if (-not $Hash) { $Hash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() }
    Set-Content -LiteralPath (Get-FixturePath "$download/$Tag/SHA256SUMS") -Value "$Hash  $asset" -Encoding Ascii
  }

  # --- Runners ---------------------------------------------------------------
  function Invoke-Bootstrap([string[]]$Arguments) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap @Arguments | Out-Host
    return $LASTEXITCODE
  }
  # Same, but with the fake web functions loaded; the script still runs as a file.
  function Invoke-Online([string]$ArgumentText) {
    $command = ". '$fakeWeb'; & '$bootstrap' $ArgumentText; exit `$LASTEXITCODE"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $command | Out-Host
    return $LASTEXITCODE
  }
  function Assert-Code([int]$Actual, [int]$Expected, [string]$What) {
    if ($Actual -ne $Expected) { Fail "$What exited $Actual, expected $Expected" }
  }

  function Assert-Installed {
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { Fail "marker missing: $marker" }
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { Fail 'Markdown Office.exe missing' }
    if (-not (Test-Path -LiteralPath $cmdPath -PathType Leaf)) { Fail "command missing: $cmdPath" }
    $launcher = Get-Content -LiteralPath $cmdPath -Raw
    if ($launcher -notmatch [regex]::Escape('"%LOCALAPPDATA%\mdo home\Markdown Office.exe" "%LOCALAPPDATA%\mdo home\resources\pipeline\cli.js" %*')) { Fail "command does not run cli.js via %LOCALAPPDATA%: $launcher" }
    if ($launcher -notmatch 'set ELECTRON_RUN_AS_NODE=1') { Fail 'command does not run cli.js as Node' }
    if ($launcher -notmatch 'setlocal') { Fail 'command leaks ELECTRON_RUN_AS_NODE into the console' }
    if (-not (Test-Path -LiteralPath $shortcut -PathType Leaf)) { Fail "shortcut missing: $shortcut" }
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
    if ($target -ne $exe) { Fail "shortcut points to '$target'" }
    $lines = @(& $cmdPath --version | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) { Fail "--version exited $LASTEXITCODE" }
    if ($lines.Count -lt 2 -or $lines[0] -ne "markdown-office $version") { Fail "--version printed '$($lines -join ' | ')', expected 'markdown-office $version' first" }
    if (-not ($lines | Where-Object { $_ -like "typst $typstVersion *" })) { Fail "--version lacks 'typst $typstVersion': $($lines -join ' | ')" }
    $leftovers = @(Get-ChildItem -LiteralPath (Split-Path -Parent $installDir) -Force | Where-Object { $_.Name -like '*.old' -or $_.Name -like '*.old-*' -or $_.Name -like '.*-new.*' })
    if ($leftovers.Count -gt 0) { Fail "leftover staging/.old folders: $(($leftovers | ForEach-Object { $_.Name }) -join ', ')" }
    Assert-ContextMenu
  }

  function Get-RegValue([string]$SubKey, [string]$Name) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey)
    if ($null -eq $key) { return $null }
    try { return $key.GetValue($Name) } finally { $key.Close() }
  }

  function Test-RegKey([string]$SubKey) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey)
    if ($null -eq $key) { return $false }
    $key.Close()
    return $true
  }

  # The verb for .md and .markdown: title, tag, icon and the exact command line (wscript.exe, a
  # GUI program, with the helper in the install folder and the selected file as "%1").
  function Assert-ContextMenu {
    if (-not (Test-Path -LiteralPath $pdfHelper -PathType Leaf)) { Fail "helper missing: $pdfHelper" }
    $record = @(Get-Content -LiteralPath (Join-Path $installDir '.mdo-file-manager'))
    $expected = '"{0}" //B //NoLogo //E:JScript "{1}" "%1"' -f $wscript, $pdfHelper
    foreach ($sub in $verbKeys) {
      if ((Get-RegValue $sub 'MUIVerb') -ne 'Markdown-PDF') { Fail "verb title missing: HKCU\$sub" }
      if ((Get-RegValue $sub 'MarkdownOfficeBootstrap') -ne 'Markdown-PDF (Markdown Office bootstrap)') { Fail "verb tag missing: HKCU\$sub" }
      if ((Get-RegValue $sub 'Icon') -ne "$exe,0") { Fail "verb icon: $(Get-RegValue $sub 'Icon')" }
      $command = Get-RegValue "$sub\command" ''
      if ($command -ne $expected) { Fail "verb command is '$command', expected '$expected'" }
      if ($record -notcontains "K $sub") { Fail "record lacks K $sub" }
    }
    if ($record -notcontains "E $regRoot") { Fail "record lacks the created key $regRoot" }
    Assert-DefaultApp
  }

  # Registered as a program for .md/.markdown: ProgID opening the file with the app, "Open
  # with" entries, and Capabilities + RegisteredApplications for Settings -> Default apps.
  function Assert-DefaultApp {
    $tag = 'Standardprogramm (Markdown Office)'
    if ((Get-RegValue $progKey 'MarkdownOfficeBootstrap') -ne $tag) { Fail "ProgID tag missing: HKCU\$progKey" }
    $open = Get-RegValue "$progKey\shell\open\command" ''
    if ($open -ne ('"{0}" "%1"' -f $exe)) { Fail "ProgID command is '$open'" }
    foreach ($ext in @('.md', '.markdown')) {
      $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$env:MDO_CLASSES_KEY\$ext\OpenWithProgids")
      if ($null -eq $key) { Fail "OpenWithProgids missing for $ext" }
      try { if (@($key.GetValueNames()) -notcontains 'MarkdownOffice.md') { Fail "OpenWithProgids lacks MarkdownOffice.md for $ext" } } finally { $key.Close() }
      if ((Get-RegValue "$capsKey\FileAssociations" $ext) -ne 'MarkdownOffice.md') { Fail "Capabilities lack $ext" }
    }
    if ((Get-RegValue $capsKey 'ApplicationName') -ne 'Markdown Office') { Fail 'Capabilities lack ApplicationName' }
    if ((Get-RegValue "$env:MDO_SOFTWARE_KEY\RegisteredApplications" 'Markdown Office') -ne $capsKey) { Fail 'RegisteredApplications entry missing' }
  }

  # Runs the .md verb's command line as Explorer does (%1 = the selected file) and waits.
  function Invoke-ContextMenu([string]$Note) {
    $command = [string](Get-RegValue "$($verbKeys[0])\command" '')
    if ($command -notmatch '^"([^"]+)" (.*)$') { Fail "unexpected verb command: $command" }
    $file = $Matches[1]
    $arguments = $Matches[2].Replace('%1', $Note)
    if (Test-Path -LiteralPath $notifyLog) { Remove-Item -LiteralPath $notifyLog -Force }
    $proc = Start-Process -FilePath $file -ArgumentList $arguments -Wait -PassThru
    return $proc.ExitCode
  }

  function Get-NotifyLog {
    if (-not (Test-Path -LiteralPath $notifyLog)) { return '' }
    return [IO.File]::ReadAllText($notifyLog)
  }

  # The verb end to end: a PDF next to a note in a folder with spaces (ISO date prefix from
  # date:), a broken note and a non-Markdown file each report an error (exit 1) instead of a
  # message box (MDO_NOTIFY_LOG).
  function Assert-ContextMenuWorks {
    $notes = Join-Path $work 'Notizen mit Leerzeichen'
    New-Item -ItemType Directory -Force -Path $notes | Out-Null
    $env:MDO_NOTIFY_LOG = $notifyLog
    try {
      $note = Join-Path $notes 'Notiz mit Leerzeichen.md'
      Set-Content -LiteralPath $note -Value @('---', 'title: Kontextmenue', 'date: 2026-10-20', '---', '', '# Hallo', '', 'Text.') -Encoding Ascii
      $code = Invoke-ContextMenu $note
      if ($code -ne 0) { Fail "Markdown-PDF exited $code converting a note: $(Get-NotifyLog)" }
      $pdf = Join-Path $notes '2026-10-20_Notiz mit Leerzeichen.pdf'
      if (-not (Test-Path -LiteralPath $pdf -PathType Leaf)) { Fail "Markdown-PDF wrote no $pdf" }
      $head = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($pdf), 0, 5)
      if ($head -ne '%PDF-') { Fail "not a PDF: $head" }
      if ((Get-NotifyLog) -notmatch 'normal\|PDF erstellt') { Fail "no success report: $(Get-NotifyLog)" }

      $broken = Join-Path $notes 'Kaputt.md'
      Set-Content -LiteralPath $broken -Value @('---', 'template: gibt-es-nicht', '---', '', 'Text.') -Encoding Ascii
      $code = Invoke-ContextMenu $broken
      if ($code -ne 1) { Fail "Markdown-PDF exited $code for a broken note, expected 1" }
      $report = Get-NotifyLog
      if ($report -notmatch 'critical\|' -or $report -notmatch 'Kaputt\.md: ' -or $report -notmatch 'markdown-pdf\.log') { Fail "error report: $report" }

      $text = Join-Path $notes 'Liste.txt'
      Set-Content -LiteralPath $text -Value 'kein Markdown' -Encoding Ascii
      $code = Invoke-ContextMenu $text
      if ($code -ne 1) { Fail "Markdown-PDF exited $code for a .txt file, expected 1" }
      if ((Get-NotifyLog) -notmatch 'critical\|Keine Markdown-Datei') { Fail "no hint for a .txt file: $(Get-NotifyLog)" }
    } finally {
      Remove-Item Env:MDO_NOTIFY_LOG
    }
    Remove-Item -LiteralPath $notes -Recurse -Force
  }

  # The installed command end to end: a PDF from a note in a folder with spaces (options and
  # paths pass through %* unchanged, exit code 0), --app --version reaching the editor, and a
  # plain --app starting the editor detached (the command returns while the app runs).
  function Assert-CommandWorks {
    $notes = Join-Path $work 'Meine Notizen'
    New-Item -ItemType Directory -Force -Path $notes | Out-Null
    $note = Join-Path $notes 'Notiz mit Leerzeichen.md'
    $pdf = Join-Path $notes 'Ergebnis mit Leerzeichen.pdf'
    Set-Content -LiteralPath $note -Value @('---', 'title: Test', '---', '', '# Hallo', '', 'Text.') -Encoding Ascii
    & $cmdPath --no-source --template memo $note $pdf | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail "markdown-office exited $LASTEXITCODE converting a note" }
    if (-not (Test-Path -LiteralPath $pdf -PathType Leaf)) { Fail 'no PDF written' }
    $head = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($pdf), 0, 5)
    if ($head -ne '%PDF-') { Fail "not a PDF: $head" }

    $out = (& $cmdPath --app --version | Out-String).Trim()
    if ($out -ne "Markdown Office $version") { Fail "--app --version printed '$out', expected 'Markdown Office $version'" }

    # Isolated settings and single-instance lock; the editor is closed again right after.
    $env:MDO_USER_DATA = Join-Path $work 'user data'
    try {
      $watch = [Diagnostics.Stopwatch]::StartNew()
      & $cmdPath --app $note | Out-Host
      $code = $LASTEXITCODE
      $watch.Stop()
      if ($code -ne 0) { Fail "--app exited $code" }
      $running = $null
      for ($i = 0; $i -lt 60 -and -not $running; $i++) {
        $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
        if ($running.Count -eq 0) { $running = $null; Start-Sleep -Milliseconds 250 }
      }
      if (-not $running) { Fail '--app did not start the editor' }
      if ($watch.Elapsed.TotalSeconds -gt 20) { Fail "--app blocked for $($watch.Elapsed.TotalSeconds) s" }
    } finally {
      Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force -ErrorAction SilentlyContinue
      for ($i = 0; $i -lt 40; $i++) {
        if (-not @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }).Count) { break }
        Start-Sleep -Milliseconds 250
      }
      Remove-Item Env:MDO_USER_DATA
    }
    Remove-Item -LiteralPath $notes -Recurse -Force
  }

  # An install leftover (<install>.old) that the bootstrap must recognise as its own.
  function New-OwnedOld {
    New-Item -ItemType Directory -Force -Path $oldDir | Out-Null
    Set-Content -LiteralPath (Join-Path $oldDir '.mdo-install') -Value 'markdown-office' -Encoding Ascii
    Set-Content -LiteralPath (Join-Path $oldDir 'Markdown Office.exe') -Value 'stub' -Encoding Ascii
  }

  # 1. Usage errors exit 2 and change nothing.
  Assert-Code (Invoke-Bootstrap @('-Pre', '-Version', '26.10.0')) 2 '-Pre -Version'
  Assert-Code (Invoke-Bootstrap @('-Version', '1.2')) 2 '-Version 1.2'
  if (Test-Path -LiteralPath $installDir) { Fail 'usage errors created the install folder' }
  Pass 'usage errors (-Pre with -Version, bad -Version) -> exit 2'

  # 2. Fresh install from the local archive.
  $env:MDO_ARCHIVE = $Archive
  Assert-Code (Invoke-Bootstrap @()) 0 'install'
  Assert-Installed
  Pass "install: marker, command, shortcut, markdown-office --version = $version + typst $typstVersion"
  Assert-CommandWorks
  Assert-Installed
  Pass 'command: PDF from a note in a folder with spaces; --app --version; --app starts the editor detached'
  Assert-ContextMenuWorks
  Pass 'Explorer verb Markdown-PDF (.md, .markdown): PDF next to the note; broken note and .txt -> error report, exit 1'

  # 3. Update via a script block like "irm | iex", and with a trailing backslash on MDO_HOME.
  $block = "& ([scriptblock]::Create((Get-Content -Raw -LiteralPath '$bootstrap')))"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $block | Out-Host
  Assert-Code $LASTEXITCODE 0 'update via script block'
  Assert-Installed
  $env:MDO_HOME = $installDir + '\'
  Assert-Code (Invoke-Bootstrap @()) 0 'update with trailing backslash on MDO_HOME'
  $env:MDO_HOME = $installDir
  Assert-Installed
  Assert-ContextMenuWorks
  Pass 'update over existing install (script block; MDO_HOME with trailing backslash); Markdown-PDF still works'

  # 3b. The documented "irm | iex" one-liner, fed from the local file: it updates, and an
  #     error throws instead of calling exit, so the user's window stays open.
  $iex = "Get-Content -Raw -LiteralPath '$bootstrap' | Invoke-Expression"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $iex | Out-Host
  Assert-Code $LASTEXITCODE 0 'update via irm | iex'
  Assert-Installed
  $env:MDO_ARCHIVE = Join-Path $work 'missing.zip'
  $probe = "try { Get-Content -Raw -LiteralPath '$bootstrap' | Invoke-Expression } catch { Write-Host ('caught: ' + `$_.Exception.Message) }; Write-Host 'host still running'; exit 0"
  $out = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $probe | Out-String)
  $env:MDO_ARCHIVE = $Archive
  if ($out -notmatch 'caught: ') { Fail "an error under irm | iex did not throw: $out" }
  if ($out -notmatch 'host still running') { Fail "the bootstrap under irm | iex ended the host: $out" }
  Assert-Installed
  Pass 'irm | iex: update works; an error throws and keeps the window open'

  # 4. A broken archive aborts before anything is replaced; the old install keeps working.
  $broken = Join-Path $work 'broken.zip'
  Set-Content -LiteralPath $broken -Value 'not an archive' -Encoding Ascii
  $env:MDO_ARCHIVE = $broken
  Assert-Code (Invoke-Bootstrap @()) 6 'broken archive'
  $env:MDO_ARCHIVE = $Archive
  Assert-Installed
  Pass 'broken archive -> exit 6, old install intact'

  # 5. Leftover .old: an own one is cleared on update; a foreign one does not block the
  #    update (the live folder is renamed to a unique .old-<id>) and stays untouched.
  New-OwnedOld
  Assert-Code (Invoke-Bootstrap @()) 0 'update with own .old'
  Assert-Installed
  New-Item -ItemType Directory -Force -Path $oldDir | Out-Null
  Set-Content -LiteralPath (Join-Path $oldDir 'keep.txt') -Value 'keep' -Encoding Ascii
  Assert-Code (Invoke-Bootstrap @()) 0 'update with foreign .old'
  if (-not (Test-Path -LiteralPath (Join-Path $oldDir 'keep.txt'))) { Fail 'update deleted a foreign .old' }
  Remove-Item -LiteralPath $oldDir -Recurse -Force
  Assert-Installed
  Pass 'leftover .old: own one removed on update, foreign one kept (update proceeds)'
  Remove-Item Env:MDO_ARCHIVE

  # 5b. -Archive/-Sums (the app's update): checked against SHA256SUMS under the asset name of
  #     -Version and installed without the network; usage errors -> 2, a wrong sum -> 5.
  $localSums = Join-Path $work 'SHA256SUMS'
  $localHash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath $localSums -Value "$localHash  markdown-office-$version-win-x64.zip" -Encoding Ascii
  Assert-Code (Invoke-Bootstrap @('-Version', $version, '-Archive', $Archive)) 2 '-Archive without -Sums'
  Assert-Code (Invoke-Bootstrap @('-Archive', $Archive, '-Sums', $localSums)) 2 '-Archive without -Version'
  Assert-Code (Invoke-Bootstrap @('-Version', $version, '-Archive', $Archive, '-Sums', $localSums)) 0 '-Archive install'
  Assert-Installed
  Set-Content -LiteralPath $localSums -Value ('0' * 64 + "  markdown-office-$version-win-x64.zip") -Encoding Ascii
  Assert-Code (Invoke-Bootstrap @('-Version', $version, '-Archive', $Archive, '-Sums', $localSums)) 5 '-Archive wrong sum'
  Assert-Installed
  Pass '-Archive/-Sums: checked and installed offline; usage errors -> 2, wrong sum -> 5'

  # 6. Download path against the fake GitHub.
  $latest = Get-FixturePath "$api/latest"
  Assert-Code (Invoke-Online '') 8 'no stable release'
  Set-Content -LiteralPath "$latest.offline" -Value '' -Encoding Ascii
  Assert-Code (Invoke-Online '') 4 'offline'
  Remove-Item -LiteralPath "$latest.offline"
  Set-Content -LiteralPath "$latest.status" -Value '403' -Encoding Ascii
  Set-Content -LiteralPath "$latest.headers" -Value @('X-RateLimit-Remaining: 0', 'X-RateLimit-Reset: 1700000000') -Encoding Ascii
  Assert-Code (Invoke-Online '') 10 'rate limit'
  Remove-Item -LiteralPath "$latest.status", "$latest.headers"
  Assert-Code (Invoke-Online '-Version 0.0.2') 9 'unknown version'
  Assert-Installed
  Pass 'API errors: no stable release -> 8, offline -> 4, rate limit -> 10, unknown version -> 9'

  Set-Content -LiteralPath $latest -Value (New-ReleaseJson "v$version" 'false' 'false') -Encoding Ascii
  Publish-Assets "v$version"
  Assert-Code (Invoke-Online '') 0 'download install'
  Assert-Installed
  $log = Get-Content -LiteralPath (Join-Path $fake 'requests.log')
  if ($log -notcontains "$api/latest") { Fail 'default channel did not ask /releases/latest' }
  if ($log -notcontains "$download/v$version/markdown-office-$version-win-x64.zip") { Fail 'wrong asset downloaded' }
  Pass 'download: /releases/latest, checksum ok, installed'

  $list = '[' + ((New-ReleaseJson 'v98.0.0-dev.1' 'true' 'true'), (New-ReleaseJson 'v99.0.0' 'false' 'false'), (New-ReleaseJson "v$version" 'true' 'false') -join ', ') + ']'
  Set-Content -LiteralPath (Get-FixturePath ($api + '?per_page=50')) -Value $list -Encoding Ascii
  Publish-Assets 'v99.0.0'
  Remove-Item -LiteralPath (Join-Path $fake 'requests.log')
  Assert-Code (Invoke-Online '-Pre') 0 'download -Pre'
  Assert-Installed
  $log = Get-Content -LiteralPath (Join-Path $fake 'requests.log')
  if ($log -notcontains "$download/v$version/markdown-office-$version-win-x64.zip") { Fail '-Pre picked the wrong release' }
  Pass '-Pre: newest published pre-release chosen (draft and stable skipped)'

  Set-Content -LiteralPath (Get-FixturePath "$api/tags/v0.0.1") -Value (New-ReleaseJson 'v0.0.1' 'false' 'false') -Encoding Ascii
  Publish-Assets 'v0.0.1' ('0' * 64)
  Assert-Code (Invoke-Online '-Version 0.0.1') 5 'bad checksum'
  Assert-Installed
  Pass '-Version with bad checksum -> exit 5, install intact'

  # 7. Uninstall and update while Markdown Office.exe is open: refused before anything is
  #    touched (marker, command, shortcut and every file stay; no .old-* is left behind).
  $before = @(Get-ChildItem -LiteralPath $installDir -Recurse -Force | ForEach-Object { $_.FullName }).Count
  $handle = [IO.File]::Open($exe, 'Open', 'Read', 'Read')
  try {
    Assert-Code (Invoke-Bootstrap @('-Uninstall')) 12 'uninstall while running'
    $env:MDO_ARCHIVE = $Archive
    $code = Invoke-Bootstrap @()
    Remove-Item Env:MDO_ARCHIVE
    Assert-Code $code 12 'update while running'
  } finally {
    $handle.Close()
  }
  $after = @(Get-ChildItem -LiteralPath $installDir -Recurse -Force | ForEach-Object { $_.FullName }).Count
  if ($after -ne $before) { Fail "files changed while refusing: $before before, $after after" }
  Assert-Installed
  Pass 'uninstall/update while Markdown Office.exe is in use -> exit 12, nothing changed'

  # 8. Uninstall (script-block form with -Uninstall) removes command, shortcut, install
  #    folder and an own .old, and never follows a junction out of the folder.
  $outside = Join-Path $work 'outside'
  New-Item -ItemType Directory -Path $outside | Out-Null
  Set-Content -LiteralPath (Join-Path $outside 'precious.txt') -Value 'keep' -Encoding Ascii
  New-Item -ItemType Junction -Path (Join-Path $installDir 'link') -Target $outside | Out-Null
  New-OwnedOld
  # As the documented script-block one-liner with -Uninstall.
  $block = "& ([scriptblock]::Create((Get-Content -Raw -LiteralPath '$bootstrap'))) -Uninstall"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $block | Out-Host
  Assert-Code $LASTEXITCODE 0 'uninstall via script block'
  foreach ($path in @($installDir, $oldDir, $cmdPath, $shortcut)) {
    if (Test-Path -LiteralPath $path) { Fail "still there after uninstall: $path" }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $outside 'precious.txt'))) { Fail 'uninstall followed a junction' }
  foreach ($sub in $verbKeys) {
    if (Test-RegKey $sub) { Fail "verb still there after uninstall: HKCU\$sub" }
  }
  # Every key the install created is gone again, up to the test root it had to create.
  if (Test-RegKey $regRoot) { Fail "uninstall left created registry keys below HKCU\$regRoot" }
  Pass 'uninstall removed everything (incl. own .old, Explorer verbs, the program registration and the keys they needed), junction target untouched'

  # 8b. A verb of the same name that is not ours is neither overwritten nor removed.
  $foreignVerb = $verbKeys[1]
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($foreignVerb)
  $key.SetValue('MUIVerb', 'Fremd')
  $key.Close()
  $env:MDO_ARCHIVE = $Archive
  Assert-Code (Invoke-Bootstrap @()) 0 'install next to a foreign verb'
  Remove-Item Env:MDO_ARCHIVE
  if ((Get-RegValue $foreignVerb 'MUIVerb') -ne 'Fremd' -or (Get-RegValue $foreignVerb 'MarkdownOfficeBootstrap')) { Fail 'install overwrote a foreign verb' }
  if ((Get-RegValue $verbKeys[0] 'MUIVerb') -ne 'Markdown-PDF') { Fail 'install skipped the .md verb because of a foreign .markdown verb' }
  Assert-Code (Invoke-Bootstrap @('-Uninstall')) 0 'uninstall next to a foreign verb'
  if ((Get-RegValue $foreignVerb 'MUIVerb') -ne 'Fremd') { Fail 'uninstall removed a foreign verb' }
  if (Test-RegKey $verbKeys[0]) { Fail 'uninstall left the .md verb' }
  [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($regRoot, $false)
  Pass 'foreign verb of the same name: install and uninstall leave it alone'

  # 9. A folder without the marker, or with a marker but no Markdown Office.exe, is never
  #    deleted or overwritten.
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  $keep = Join-Path $installDir 'keep.txt'
  Set-Content -LiteralPath $keep -Value 'keep' -Encoding Ascii
  foreach ($case in @('no marker', 'marker without Markdown Office.exe')) {
    if ($case -eq 'marker without Markdown Office.exe') {
      Set-Content -LiteralPath $marker -Value 'markdown-office' -Encoding Ascii
    }
    Assert-Code (Invoke-Bootstrap @('-Uninstall')) 1 "uninstall ($case)"
    if (-not (Test-Path -LiteralPath $keep)) { Fail "uninstall deleted a folder ($case)" }
    $env:MDO_ARCHIVE = $Archive
    $code = Invoke-Bootstrap @()
    Remove-Item Env:MDO_ARCHIVE
    Assert-Code $code 1 "install ($case)"
    if (-not (Test-Path -LiteralPath $keep)) { Fail "install replaced a folder ($case)" }
  }
  Pass 'foreign folder (no marker / marker without Markdown Office.exe): refuse (exit 1), folder intact'

  Write-Host 'All bootstrap checks passed.'
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  if ($regRoot) { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($regRoot, $false) }
}
# The expected refusals above leave LASTEXITCODE non-zero; the CI shell would report it.
exit 0
