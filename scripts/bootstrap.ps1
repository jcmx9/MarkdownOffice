<#
.SYNOPSIS
  Ein-Zeiler-Bootstrap fuer Markdown Office (Windows).
.DESCRIPTION
  Installieren / Aktualisieren (neueste stabile Version):
    irm https://raw.githubusercontent.com/jcmx9/MarkdownOffice/main/scripts/bootstrap.ps1 | iex
  Vorabversion testen (neueste Pre-Release; kann aelter sein als die neueste stabile):
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/jcmx9/MarkdownOffice/dev/scripts/bootstrap.ps1))) -Pre
  Bestimmte Version:   ... -Version 26.10.0   (oder 26.10.0-dev.1)
  Aus geladenem Archiv: ... -Version X -Archive DATEI.zip -Sums SHA256SUMS
                       (Pruefsumme gegen SHA256SUMS, kein Download; so ruft die App
                       das Update auf)
  Deinstallieren:      ... -Uninstall

  Laedt das passende Archiv der GitHub-Release, prueft es gegen SHA256SUMS und
  installiert ohne Adminrechte nach %LOCALAPPDATA%\Markdown Office, legt den Befehl
  %LOCALAPPDATA%\Microsoft\WindowsApps\markdown-office.cmd und eine
  Startmenue-Verknuepfung an:
    markdown-office notiz.md [ziel.pdf] [Optionen]   PDF erzeugen (Pipeline)
    markdown-office --app [notiz.md ...]             Editor starten
  Dazu der Explorer-Kontextmenue-Eintrag "Markdown-PDF" fuer .md/.markdown (unter
  HKCU\Software\Classes\SystemFileAssociations; Windows 11: "Weitere Optionen anzeigen"):
  PDF neben der Notiz, ohne den Editor. Was angelegt wurde, steht in .mdo-file-manager
  neben dem Marker; nur das entfernt die Deinstallation.
  Dokumente, Vorlagen-Sets, Snippets und Einstellungen werden nie angetastet.

  Umgebung (fuer Tests):
    MDO_ARCHIVE  lokales .zip statt Download (keine Pruefsumme)
    MDO_HOME     Installordner statt %LOCALAPPDATA%\Markdown Office

  Exit-Codes (bei Aufruf als Datei):
    0 ok, 1 Sicherheitsabbruch (keine Markdown-Office-Installation), 2 falscher Aufruf,
    4 offline / Download-Fehler, 5 Pruefsumme falsch,
    6 Installation fehlgeschlagen (alte Version unveraendert),
    7 Wiederherstellung fehlgeschlagen - manuell noetig (Pfad wird ausgegeben),
    8 keine passende Release (noch keine stabile, keine Vorabversion, Datei fehlt),
    9 Version gibt es nicht, 10 GitHub-Abfragelimit erreicht,
    11 unerwarteter Fehler, 12 Markdown Office laeuft noch (nichts veraendert).
  Ueber "irm | iex" wird statt exit eine Ausnahme geworfen, damit das Fenster offen bleibt.
#>
# Windows PowerShell 5.1 compatible: no ??, no ternary, no -Parallel. ASCII only, because
# 5.1 reads BOM-less files and irm responses with a legacy code page.
[CmdletBinding()]
param(
  [switch]$Pre,
  [string]$Version = '',
  [string]$Archive = '',
  [string]$Sums = '',
  [switch]$Uninstall
)

# Everything runs in a child scope: StrictMode, preferences and helper functions stay
# inside it, so "irm | iex" leaves the user's session as it was. TLS is process-wide and
# is restored afterwards.
$MdoSavedTls = [Net.ServicePointManager]::SecurityProtocol
try {
  & {
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    # Invoke-WebRequest in 5.1 is many times slower with the progress bar.
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = $MdoSavedTls -bor [Net.SecurityProtocolType]::Tls12

    $MdoFromFile = -not [string]::IsNullOrEmpty((Get-Variable -Name PSCommandPath -ValueOnly -ErrorAction SilentlyContinue))
    $MdoCleanup = New-Object System.Collections.ArrayList
    $MdoStopMessage = 'Markdown-Office-Bootstrap abgebrochen'

    $MdoRepo      = 'jcmx9/MarkdownOffice'
    $MdoApi       = "https://api.github.com/repos/$MdoRepo/releases"
    $MarkerName   = '.mdo-install'
    $ExeName      = 'Markdown Office.exe'
    $LauncherTag  = 'rem markdown-office command (Markdown Office bootstrap)'
    $VersionRegex = '^[0-9]+\.[0-9]+\.[0-9]+(-dev\.[0-9]+)?$'

    $LocalAppData = $env:LOCALAPPDATA
    if ($env:MDO_HOME) {
      $InstallDir = [IO.Path]::GetFullPath($env:MDO_HOME.TrimEnd('\', '/'))
    } else {
      $InstallDir = Join-Path $LocalAppData 'Markdown Office'
    }
    # A unique name per run: the rename of the live folder is the first action and needs
    # no cleanup before it; leftovers (<leaf>.old, <leaf>.old-*) are cleared afterwards.
    $OldDir    = $InstallDir + '.old-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    $Exe       = Join-Path $InstallDir $ExeName
    $WinApps   = Join-Path $LocalAppData 'Microsoft\WindowsApps'
    $CmdPath   = Join-Path $WinApps 'markdown-office.cmd'
    $StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $Shortcut  = Join-Path $StartMenu 'Markdown Office.lnk'
    $WantVersion = $Version.TrimStart('v')
    # Explorer context-menu entry "Markdown-PDF" for .md/.markdown (see Write-MdoContextMenu).
    # The helper and the record of the created registry keys live in the install folder, next
    # to the marker; MDO_CLASSES_KEY (tests) moves the keys away from HKCU\Software\Classes.
    $PdfAction     = 'Markdown-PDF'
    $PdfTag        = 'Markdown-PDF (Markdown Office bootstrap)'
    $PdfHelper     = Join-Path $InstallDir 'markdown-pdf.js'
    $RecordPath    = Join-Path $InstallDir '.mdo-file-manager'
    $PdfExtensions = @('.md', '.markdown')
    $ClassesKey    = 'Software\Classes'
    if ($env:MDO_CLASSES_KEY) { $ClassesKey = $env:MDO_CLASSES_KEY.Trim('\') }
    $WScriptExe    = Join-Path $env:SystemRoot 'System32\wscript.exe'
    # Registration as a program for .md/.markdown (see Write-MdoDefaultApp); the same keys as
    # src/main/default-app.ts writes from the settings. MDO_SOFTWARE_KEY (tests) moves the keys
    # below HKCU\Software away, like MDO_CLASSES_KEY.
    $ProgId          = 'MarkdownOffice.md'
    $AppName         = 'Markdown Office'
    $DefaultAppTag   = 'Standardprogramm (Markdown Office)'
    $SoftwareKey     = 'Software'
    if ($env:MDO_SOFTWARE_KEY) { $SoftwareKey = $env:MDO_SOFTWARE_KEY.Trim('\') }
    $CapabilitiesKey = "$SoftwareKey\Markdown Office\Capabilities"
    $RegisteredApps  = "$SoftwareKey\RegisteredApplications"

    function Write-Step([string]$Message) { Write-Host "-> $Message" }
    function Write-Ok([string]$Message) { Write-Host "OK  $Message" -ForegroundColor Green }
    function Write-Warn([string]$Message) { Write-Host "Warnung: $Message" -ForegroundColor Yellow }

    # --- Removal without following links ---------------------------------------

    # Deletes a tree; junctions and symlinks are removed as links, never followed, so
    # nothing outside the folder can be hit.
    function Remove-MdoTree([string]$Path) {
      $item = Get-Item -LiteralPath $Path -Force
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if ($item.PSIsContainer) { [IO.Directory]::Delete($item.FullName, $false) } else { $item.Delete() }
        return
      }
      if ($item.PSIsContainer) {
        foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)) { Remove-MdoTree $child.FullName }
        $item.Attributes = [IO.FileAttributes]::Directory
        [IO.Directory]::Delete($item.FullName, $false)
      } else {
        $item.Attributes = [IO.FileAttributes]::Normal
        $item.Delete()
      }
    }

    function Remove-MdoTemp {
      foreach ($path in @($MdoCleanup)) {
        if ($path -and (Test-Path -LiteralPath $path)) {
          try { Remove-MdoTree $path } catch { Write-Warn "Temporaerer Ordner bleibt: $path" }
        }
      }
      $MdoCleanup.Clear()
    }

    # Stops with an exit code when run as a file (CI); under irm | iex, exit would close
    # the user's PowerShell window, so it throws instead.
    function Stop-Mdo([int]$Code, [string]$Message) {
      Write-Host "Error: $Message" -ForegroundColor Red
      Remove-MdoTemp
      if ($MdoFromFile) { exit $Code }
      throw "$MdoStopMessage (Code $Code)."
    }

    function Stop-Foreign([string]$Path) {
      Write-Host "Error: $Path existiert, ist aber keine Markdown-Office-Installation dieses Skripts ($MarkerName oder $ExeName fehlt)." -ForegroundColor Red
      Write-Host 'Gefunden:'
      Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | Format-Table Mode, LastWriteTime, Length, Name -AutoSize | Out-String | Write-Host
      Stop-Mdo 1 'Abbruch - der Ordner wird nicht angetastet. Bitte selbst pruefen und ggf. entfernen.'
    }

    # Ours = marker AND Markdown Office.exe in the folder.
    function Test-MdoOwned([string]$Dir) {
      return ((Test-Path -LiteralPath (Join-Path $Dir $MarkerName) -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $Dir $ExeName) -PathType Leaf))
    }

    # Renames a folder with [IO.Directory]::Move: a pure rename that fails as a whole.
    # (Move-Item falls back to copy-and-delete for a folder whose rename fails, which
    # half-moved a running install.) Retries because Defender, the indexer or exiting
    # child processes can hold handles for a moment. -Patient: for the freshly extracted
    # install and for the rollback, where Defender may scan ~300 MB of new files for
    # many seconds (seen in CI: 5 tries within 3 s were not enough); up to 10 tries
    # within ~13 s. Without it the first move (old install aside) stays quick, so a
    # running app is reported at once.
    function Move-MdoDir([string]$From, [string]$To, [switch]$Patient) {
      $tries = if ($Patient) { 10 } else { 5 }
      for ($attempt = 1; $attempt -le $tries; $attempt++) {
        try {
          [IO.Directory]::Move($From, $To)
          return $true
        } catch {
          if ($attempt -lt $tries) { Start-Sleep -Milliseconds (300 * $attempt) }
        }
      }
      return $false
    }

    function Test-OwnLauncher {
      if (-not (Test-Path -LiteralPath $CmdPath -PathType Leaf)) { return $false }
      return ((Get-Content -LiteralPath $CmdPath -Raw) -match [regex]::Escape($LauncherTag))
    }

    function Test-OwnShortcut {
      if (-not (Test-Path -LiteralPath $Shortcut -PathType Leaf)) { return $false }
      try {
        $shell = New-Object -ComObject WScript.Shell
        return ($shell.CreateShortcut($Shortcut).TargetPath -eq $Exe)
      } catch {
        return $false
      }
    }

    # --- Release lookup -------------------------------------------------------
    # One unauthenticated API call (limit 60/h): /releases/latest never returns a
    # pre-release; -Pre scans the newest 50 releases; -Version asks for the exact tag.

    function Get-HttpStatus($ErrorRecord) {
      $response = $null
      try { $response = $ErrorRecord.Exception.Response } catch { $response = $null }
      if ($null -eq $response) { return 0 }
      try { return [int]$response.StatusCode } catch { return 0 }
    }

    function Get-HttpHeader($ErrorRecord, [string]$Name) {
      $headers = $null
      try { $headers = $ErrorRecord.Exception.Response.Headers } catch { return '' }
      if ($null -eq $headers) { return '' }
      try {
        $value = $headers[$Name]
        if ($value) { return [string]$value }
      } catch { $value = $null }
      try { return [string](@($headers.GetValues($Name))[0]) } catch { return '' }
    }

    function Invoke-MdoApi([string]$Uri, [string]$What) {
      $headers = @{ Accept = 'application/vnd.github+json' }
      try {
        return Invoke-RestMethod -Uri $Uri -Headers $headers -UseBasicParsing
      } catch {
        $status = Get-HttpStatus $_
        $detail = $_.Exception.Message
        if ($status -eq 0) { Stop-Mdo 4 "Keine Verbindung zu GitHub (offline?): $detail" }
        if ($status -eq 404) {
          if ($What -eq 'latest') { Stop-Mdo 8 'Noch keine stabile Version veroeffentlicht - mit -Pre die Testversion installieren.' }
          if ($What -eq 'tag') { Stop-Mdo 9 "Version $WantVersion gibt es nicht (keine Release v$WantVersion)." }
          Stop-Mdo 4 "GitHub-API antwortet mit 404: $Uri"
        }
        if ($status -eq 429 -or ($status -eq 403 -and (Get-HttpHeader $_ 'X-RateLimit-Remaining') -eq '0')) {
          $reset = Get-HttpHeader $_ 'X-RateLimit-Reset'
          if ($reset -match '^[0-9]+$') {
            $at = [DateTimeOffset]::FromUnixTimeSeconds([long]$reset).LocalDateTime.ToString('HH:mm')
            Stop-Mdo 10 "GitHub-Abfragelimit (60 pro Stunde) erreicht - wieder moeglich ab $at Uhr."
          }
          Stop-Mdo 10 'GitHub-Abfragelimit (60 pro Stunde) erreicht - bitte spaeter erneut versuchen.'
        }
        Stop-Mdo 4 "GitHub-API antwortet mit HTTP ${status}: $detail"
      }
    }

    function Get-MdoRelease {
      if ($WantVersion) {
        $release = Invoke-MdoApi "$MdoApi/tags/v$WantVersion" 'tag'
      } elseif ($Pre) {
        # Assign first: 5.1 would pipe a JSON array as one object.
        $list = Invoke-MdoApi ($MdoApi + '?per_page=50') 'list'
        $release = $null
        foreach ($candidate in @($list)) {
          if ($candidate.prerelease -and -not $candidate.draft) { $release = $candidate; break }
        }
        if (-not $release) { Stop-Mdo 8 'Keine Vorabversion (Pre-Release) unter den letzten 50 Releases gefunden.' }
      } else {
        $release = Invoke-MdoApi "$MdoApi/latest" 'latest'
      }
      return $release
    }

    function Get-MdoDownload([string]$TempDir) {
      $release = Get-MdoRelease
      $tag = [string]$release.tag_name
      if (-not $tag) { Stop-Mdo 4 'Unerwartete Antwort der GitHub-API (kein tag_name).' }
      $ver = $tag.TrimStart('v')
      $assetName = "markdown-office-$ver-win-x64.zip"
      $asset = @($release.assets | Where-Object { $_.name -eq $assetName }) | Select-Object -First 1
      $sums = @($release.assets | Where-Object { $_.name -eq 'SHA256SUMS' }) | Select-Object -First 1
      if (-not $asset) { Stop-Mdo 8 "Release $tag enthaelt kein $assetName." }
      if (-not $sums) { Stop-Mdo 8 "Release $tag enthaelt keine SHA256SUMS." }

      $zip = Join-Path $TempDir $assetName
      $sumsFile = Join-Path $TempDir 'SHA256SUMS'
      Write-Step "Lade Markdown Office $ver ($assetName)"
      try {
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
        Invoke-WebRequest -Uri $sums.browser_download_url -OutFile $sumsFile -UseBasicParsing
      } catch {
        Stop-Mdo 4 "Download fehlgeschlagen: $($_.Exception.Message)"
      }

      Test-MdoArchive $zip $sumsFile $assetName
      return $zip
    }

    # Checks the zip against the SHA256SUMS file under the asset name; exit 5 when the sums
    # lack the name or the hash differs. One path for the download above and for an archive
    # the app already fetched (-Archive/-Sums).
    function Test-MdoArchive([string]$Zip, [string]$SumsFile, [string]$AssetName) {
      $expected = $null
      foreach ($line in (Get-Content -LiteralPath $SumsFile)) {
        $parts = $line.Trim() -split '\s+', 2
        if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $AssetName) {
          $expected = $parts[0].ToLowerInvariant()
          break
        }
      }
      if (-not $expected) { Stop-Mdo 5 "SHA256SUMS enthaelt keinen Eintrag fuer $AssetName." }
      $actual = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actual -ne $expected) {
        Stop-Mdo 5 "Pruefsumme falsch fuer $AssetName (erwartet $expected, erhalten $actual) - nichts wurde veraendert."
      }
      Write-Ok 'Pruefsumme stimmt'
    }

    # --- Install --------------------------------------------------------------

    # Extracts into a staging folder next to the target (same volume, so the swap is a
    # rename) and smoke-tests the new exe; returns the folder that becomes $InstallDir.
    function New-MdoStage([string]$Zip) {
      $parent = Split-Path -Parent $InstallDir
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
      $stage = Join-Path $parent ('.' + (Split-Path -Leaf $InstallDir) + '-new.' + [guid]::NewGuid().ToString('N').Substring(0, 8))
      [void]$MdoCleanup.Add($stage)
      try {
        Expand-Archive -LiteralPath $Zip -DestinationPath $stage -Force
      } catch {
        Stop-Mdo 6 "Archiv laesst sich nicht entpacken: $Zip ($($_.Exception.Message))"
      }
      # electron-builder's win zip has the files at the top level; accept one wrapping folder too.
      $root = $stage
      if (-not (Test-Path -LiteralPath (Join-Path $root $ExeName) -PathType Leaf)) {
        $subs = @(Get-ChildItem -LiteralPath $stage -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $ExeName) -PathType Leaf })
        if ($subs.Count -ne 1) { Stop-Mdo 6 "Archiv enthaelt kein ${ExeName}: $Zip" }
        $root = $subs[0].FullName
      }
      Get-ChildItem -LiteralPath $root -Recurse -File | Unblock-File
      # The marker travels with the folder, so it is in place before the swap.
      Set-Content -LiteralPath (Join-Path $root $MarkerName) -Value 'markdown-office' -Encoding Ascii

      # The pipeline CLI as the command runs it (the app's binary as Node: no window) prints
      # its own and Typst's version.
      $out = ''
      $savedNode = $env:ELECTRON_RUN_AS_NODE
      try {
        $env:ELECTRON_RUN_AS_NODE = '1'
        $out = (& (Join-Path $root $ExeName) (Join-Path $root 'resources\pipeline\cli.js') --version | Out-String).Trim()
      } catch {
        $out = ''
      } finally {
        $env:ELECTRON_RUN_AS_NODE = $savedNode
      }
      if ($out -notlike 'markdown-office *') { Stop-Mdo 6 'Das neue Markdown Office startet nicht - die bisherige Installation bleibt.' }
      Write-Step ("Neue Version: " + (($out -split '\r?\n') -join ' '))
      return $root
    }

    # Clears leftovers of interrupted runs (<leaf>.old, <leaf>.old-*) after the main work.
    # Only ours may go; anything else stays with a warning. Never fatal.
    function Remove-MdoOld {
      $parent = Split-Path -Parent $InstallDir
      $leaf = Split-Path -Leaf $InstallDir
      if (-not (Test-Path -LiteralPath $parent)) { return }
      $leftovers = @(Get-ChildItem -LiteralPath $parent -Directory -Force | Where-Object { $_.Name -eq "$leaf.old" -or $_.Name -like "$leaf.old-*" })
      foreach ($dir in $leftovers) {
        if (Test-MdoOwned $dir.FullName) {
          try {
            Remove-MdoTree $dir.FullName
            Write-Step "Rest eines frueheren Laufs entfernt: $($dir.FullName)"
          } catch {
            Write-Warn "Rest eines frueheren Laufs bleibt (in Benutzung?): $($dir.FullName)"
          }
        } else {
          Write-Warn "$($dir.FullName) ist keine Markdown-Office-Installation dieses Skripts - bleibt."
        }
      }
    }

    function Stop-MdoRecovery {
      Write-Host 'Error: Installation und Wiederherstellung fehlgeschlagen.' -ForegroundColor Red
      Write-Host "  Die bisherige Version liegt unveraendert in: $OldDir"
      Write-Host '  Zurueckholen mit:'
      Write-Host ("    Rename-Item -LiteralPath '{0}' -NewName '{1}'" -f ($OldDir -replace "'", "''"), ((Split-Path -Leaf $InstallDir) -replace "'", "''"))
      Stop-Mdo 7 'Bitte die bisherige Version wie oben beschrieben zurueckholen.'
    }

    # Old -> .old-<id> (first action: fails as a whole while the app runs), new -> target,
    # delete the old one; on failure the old install is restored.
    function Install-MdoStage([string]$Root) {
      $hadOld = $false
      if (Test-Path -LiteralPath $InstallDir) {
        if (-not (Move-MdoDir $InstallDir $OldDir)) {
          Stop-Mdo 12 "Konnte $InstallDir nicht ersetzen - Markdown Office laeuft noch? Bitte beenden und erneut versuchen. Es wurde nichts veraendert."
        }
        $hadOld = $true
      }
      if (-not (Move-MdoDir $Root $InstallDir -Patient)) {
        if ($hadOld) {
          if (-not (Move-MdoDir $OldDir $InstallDir -Patient)) { Stop-MdoRecovery }
          Stop-Mdo 6 'Installation fehlgeschlagen - die bisherige Version wurde wiederhergestellt.'
        }
        Stop-Mdo 6 'Installation fehlgeschlagen.'
      }
      if ($hadOld) {
        try { Remove-MdoTree $OldDir } catch { Write-Warn "Alte Version konnte nicht geloescht werden: $OldDir" }
      }
      Remove-MdoOld
      Remove-MdoTemp
    }

    function Write-MdoLauncher {
      New-Item -ItemType Directory -Force -Path $WinApps | Out-Null
      if ((Test-Path -LiteralPath $CmdPath) -and -not (Test-OwnLauncher)) {
        Stop-Mdo 1 "$CmdPath existiert und stammt nicht von Markdown Office - bitte selbst entfernen."
      }
      # %LOCALAPPDATA% keeps the file ASCII even when the user name has umlauts.
      $dirRef = $InstallDir
      if ($InstallDir.StartsWith($LocalAppData + '\', [StringComparison]::OrdinalIgnoreCase)) {
        $dirRef = '%LOCALAPPDATA%' + $InstallDir.Substring($LocalAppData.Length)
      }
      # Like VS Code's code.cmd: the app's binary runs cli.js as Node with every argument
      # unchanged (%*), and cmd waits for it and passes its exit code on. A leading --app is
      # handled by cli.js itself (it starts the editor detached), because shift would not
      # change %*. setlocal keeps ELECTRON_RUN_AS_NODE out of the caller's console.
      $lines = @(
        '@echo off',
        $LauncherTag,
        'setlocal',
        'set ELECTRON_RUN_AS_NODE=1',
        "`"$dirRef\$ExeName`" `"$dirRef\resources\pipeline\cli.js`" %*",
        'exit /b %ERRORLEVEL%'
      )
      # cmd.exe reads batch files in the OEM code page.
      $encoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
      [IO.File]::WriteAllText($CmdPath, (($lines -join "`r`n") + "`r`n"), $encoding)
    }

    # The install is complete at this point, so a failure here is only a warning.
    function Write-MdoShortcut {
      try {
        New-Item -ItemType Directory -Force -Path $StartMenu | Out-Null
        if ((Test-Path -LiteralPath $Shortcut) -and -not (Test-OwnShortcut)) {
          Write-Warn "$Shortcut zeigt nicht auf Markdown Office - Startmenue-Eintrag nicht angelegt."
          return
        }
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut($Shortcut)
        $link.TargetPath = $Exe
        $link.WorkingDirectory = $env:USERPROFILE
        $link.Description = 'Markdown-Editor mit PDF-Export'
        $link.Save()
      } catch {
        Write-Warn "Startmenue-Eintrag konnte nicht angelegt werden ($($_.Exception.Message)). Markdown Office ist trotzdem installiert."
      }
    }

    # --- Explorer context-menu entry "Markdown-PDF" ----------------------------
    # Right-click a .md/.markdown file -> "Markdown-PDF": the note becomes a PDF next to it,
    # without the editor (the predecessor real-fast-document had this as a SendTo shortcut).
    # A shell verb under HKCU\Software\Classes\SystemFileAssociations\<ext>\shell needs no admin
    # rights and, unlike SendTo, appears only for Markdown files and right in the context menu
    # (Windows 11: under "Weitere Optionen anzeigen"; the new menu would need a packaged app).
    # The verb runs markdown-pdf.js with wscript.exe: wscript and Markdown Office.exe are both
    # GUI programs, so no console window flashes up, which the .cmd command or powershell.exe
    # (even with -WindowStyle Hidden) would open. Everything here is a convenience: a failure
    # only warns, the install itself is complete at this point.
    #
    # The record (.mdo-file-manager) lists "K <key>" for each verb key written and "E <key>" for
    # each key the install had to create; uninstall removes exactly these (verbs only while they
    # carry the tag, created keys only when empty again).

    function Get-MdoVerbKeys {
      foreach ($ext in $PdfExtensions) { "$ClassesKey\SystemFileAssociations\$ext\shell\$PdfAction" }
    }

    function Test-OwnVerb([string]$SubKey) {
      $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey)
      if ($null -eq $key) { return $false }
      try { return ([string]$key.GetValue('MarkdownOfficeBootstrap') -eq $PdfTag) } finally { $key.Close() }
    }

    function Test-MdoKey([string]$SubKey) {
      $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey)
      if ($null -eq $key) { return $false }
      $key.Close()
      return $true
    }

    function Read-MdoRecord {
      if (-not (Test-Path -LiteralPath $RecordPath -PathType Leaf)) { return @() }
      return @(Get-Content -LiteralPath $RecordPath | Where-Object { $_ })
    }

    # Opens (or creates) a key below HKCU with every missing parent, recording each key it had
    # to create. RegistryKey.CreateSubKey never clears an existing key (New-Item -Force would).
    function New-MdoRegKey([string]$SubKey, [System.Collections.ArrayList]$Record) {
      $hkcu = [Microsoft.Win32.Registry]::CurrentUser
      $path = ''
      foreach ($part in $SubKey.Split('\')) {
        if ($path) { $path = "$path\$part" } else { $path = $part }
        if (Test-MdoKey $path) { continue }
        $hkcu.CreateSubKey($path).Close()
        if ($Record -notcontains "E $path") { [void]$Record.Add("E $path") }
      }
      return $hkcu.CreateSubKey($SubKey)
    }

    # The helper finds the app next to itself, so it holds no path and stays ASCII (WSH reads
    # a .js file without BOM in the ANSI code page). The messages use \u escapes for umlauts.
    function Write-MdoPdfHelper {
      $js = @'
// Markdown-PDF (Markdown Office bootstrap)
// Explorer's context-menu entry "Markdown-PDF" runs this file with wscript.exe for the selected
// Markdown file. wscript.exe and Markdown Office.exe are GUI programs: no console window opens.
// The app's binary runs the pipeline CLI as Node (ELECTRON_RUN_AS_NODE), as the markdown-office
// command does; cli.js starts PowerShell hidden. Success shows as the opened PDF, an error as a
// message box; the output of the last run stays in markdown-pdf.log next to this file.
// Written by the Markdown Office bootstrap; update and uninstall replace or remove it.
var shell = WScript.CreateObject('WScript.Shell');
var fso = WScript.CreateObject('Scripting.FileSystemObject');
var dir = fso.GetParentFolderName(WScript.ScriptFullName);
var exe = fso.BuildPath(dir, 'Markdown Office.exe');
var cli = fso.BuildPath(dir, 'resources\\pipeline\\cli.js');
var logPath = fso.BuildPath(dir, 'markdown-pdf.log');
var title = 'Markdown-PDF';
var env = shell.Environment('Process');

// Test hook (MDO_NOTIFY_LOG): collect the messages in a file instead of showing them.
function report(message, isError) {
  var target = env.Item('MDO_NOTIFY_LOG');
  if (target) {
    var f = fso.FileExists(target) ? fso.OpenTextFile(target, 8, false, -1) : fso.CreateTextFile(target, false, true);
    f.WriteLine((isError ? 'critical|' : 'normal|') + message);
    f.Close();
  } else if (isError) {
    shell.Popup(message, 0, title, 16);
  }
}

function isMarkdown(path) {
  return /\.(md|markdown)$/i.test(path);
}

// The line that says why a conversion failed: the first error line, else the last line.
function reasonOf(text) {
  var lines = text.split(/\r?\n/);
  var last = '';
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/^\s+|\s+$/g, '');
    if (/^(error|fehler)/i.test(line)) return line;
    if (line) last = line;
  }
  return last;
}

// ReadAll fails on an empty stream; AtEndOfStream waits for data or the end of the pipe.
function readAll(stream) {
  var text = '';
  while (!stream.AtEndOfStream) text += stream.ReadAll();
  return text;
}

// Windows paths cannot contain a double quote, so quoting is enough.
function quote(arg) {
  return '"' + arg + '"';
}

if (!fso.FileExists(exe) || !fso.FileExists(cli)) {
  report('Markdown Office ist nicht vollst\u00e4ndig installiert (' + exe + ' fehlt).', true);
  WScript.Quit(1);
}
env.Item('ELECTRON_RUN_AS_NODE') = '1';
var log = fso.CreateTextFile(logPath, true, true);
var converted = 0;
var failed = 0;
var errors = [];
for (var i = 0; i < WScript.Arguments.length; i++) {
  var note = WScript.Arguments.Item(i);
  if (!isMarkdown(note)) {
    log.WriteLine('\u00dcbersprungen (keine Markdown-Datei): ' + note);
    continue;
  }
  log.WriteLine('== ' + note);
  var proc = shell.Exec(quote(exe) + ' ' + quote(cli) + ' ' + quote(note));
  proc.StdIn.Close();
  // stderr first: a long error goes there, stdout only carries a few lines.
  var err = readAll(proc.StdErr);
  var out = readAll(proc.StdOut);
  while (proc.Status === 0) WScript.Sleep(50);
  log.WriteLine(out);
  log.WriteLine(err);
  if (proc.ExitCode === 0) {
    converted++;
  } else {
    failed++;
    errors.push(fso.GetFileName(note) + ': ' + reasonOf(err + '\n' + out));
  }
}
log.Close();
if (converted + failed === 0) {
  report('Keine Markdown-Datei ausgew\u00e4hlt (.md, .markdown).', true);
  WScript.Quit(1);
}
if (failed > 0) {
  var head = converted > 0 ? converted + ' PDF(s) erstellt, ' + failed + ' fehlgeschlagen.' : 'Das PDF konnte nicht erstellt werden.';
  report(head + '\n\n' + errors.join('\n') + '\n\nProtokoll: ' + logPath, true);
  WScript.Quit(1);
}
report(converted === 1 ? 'PDF erstellt.' : converted + ' PDFs erstellt.', false);
WScript.Quit(0);
'@
      [IO.File]::WriteAllText($PdfHelper, ($js -replace "`r?`n", "`r`n"), [Text.Encoding]::ASCII)
    }

    # $Previous: the record of the install this one replaces (its folder is gone by now), so keys
    # created back then are still removed on uninstall.
    function Write-MdoContextMenu([string[]]$Previous) {
      try {
        $record = New-Object System.Collections.ArrayList
        foreach ($line in @($Previous)) {
          if (($line -like 'E *' -or $line -like 'K *') -and $record -notcontains $line) { [void]$record.Add($line) }
        }
        Write-MdoPdfHelper
        $command = '"{0}" //B //NoLogo //E:JScript "{1}" "%1"' -f $WScriptExe, $PdfHelper
        foreach ($sub in @(Get-MdoVerbKeys)) {
          if ((Test-MdoKey $sub) -and -not (Test-OwnVerb $sub)) {
            Write-Warn "HKCU\$sub stammt nicht von Markdown Office - Kontextmenue-Eintrag dort nicht angelegt."
            continue
          }
          $key = New-MdoRegKey $sub $record
          try {
            $key.SetValue('', $PdfAction)
            $key.SetValue('MUIVerb', $PdfAction)
            $key.SetValue('Icon', "$Exe,0")
            $key.SetValue('MarkdownOfficeBootstrap', $PdfTag)
            $commandKey = $key.CreateSubKey('command')
            try { $commandKey.SetValue('', $command) } finally { $commandKey.Close() }
          } finally {
            $key.Close()
          }
          if ($record -notcontains "K $sub") { [void]$record.Add("K $sub") }
        }
        # The program registration shares the record (created keys), so it is written here.
        Write-MdoDefaultApp $record
        [IO.File]::WriteAllLines($RecordPath, [string[]]$record.ToArray(), (New-Object System.Text.UTF8Encoding $false))
      } catch {
        Write-Warn "Kontextmenue-Eintrag $PdfAction konnte nicht angelegt werden ($($_.Exception.Message)). Markdown Office ist trotzdem installiert."
      }
    }

    # Verb keys go only while they carry the tag; created keys only when empty and only if they
    # lie above a verb key, so an edited record cannot point anywhere else. Without a record
    # (an install from before this entry) the default verb keys are still checked.
    function Remove-MdoContextMenu([string[]]$Lines) {
      $hkcu = [Microsoft.Win32.Registry]::CurrentUser
      $verbs = New-Object System.Collections.ArrayList
      foreach ($sub in @(Get-MdoVerbKeys)) { [void]$verbs.Add($sub) }
      foreach ($line in @($Lines)) {
        if ($line -like 'K *' -and $line.EndsWith("\shell\$PdfAction") -and $verbs -notcontains $line.Substring(2)) {
          [void]$verbs.Add($line.Substring(2))
        }
      }
      foreach ($sub in $verbs) {
        if (Test-OwnVerb $sub) {
          try {
            $hkcu.DeleteSubKeyTree($sub, $false)
            Write-Step "Kontextmenue-Eintrag entfernt: HKCU\$sub"
          } catch {
            Write-Warn "Kontextmenue-Eintrag konnte nicht entfernt werden: HKCU\$sub ($($_.Exception.Message))"
          }
        } elseif (Test-MdoKey $sub) {
          Write-Warn "HKCU\$sub stammt nicht von Markdown Office - bleibt."
        }
      }
      $created = @(@($Lines) | Where-Object { $_ -like 'E *' } | ForEach-Object { $_.Substring(2) } | Sort-Object -Property Length -Descending)
      foreach ($sub in $created) {
        $above = $false
        foreach ($verb in $verbs) {
          if ($verb -eq $sub -or $verb.StartsWith("$sub\", [StringComparison]::OrdinalIgnoreCase)) { $above = $true }
        }
        if (-not $above) { continue }
        $key = $hkcu.OpenSubKey($sub)
        if ($null -eq $key) { continue }
        $empty = ($key.SubKeyCount -eq 0 -and $key.ValueCount -eq 0)
        $key.Close()
        if ($empty) {
          try { $hkcu.DeleteSubKey($sub, $false) } catch { Write-Warn "Leerer Schluessel bleibt: HKCU\$sub" }
        }
      }
    }

    # --- Program for .md files ------------------------------------------------------
    # Windows lets no program make itself the default for a file type; the user picks in
    # Settings -> Default apps, which lists only registered programs. So the install registers
    # Markdown Office for .md and .markdown below HKCU (no admin rights): a ProgID that opens the
    # file with the app, OpenWithProgids for "Open with", and Capabilities + RegisteredApplications
    # for the Default-apps list. Nothing here changes which program is the default. The app's
    # settings ("Als Standard fuer Markdown festlegen") write the same keys and open that page.
    # Keys carry the tag; created parents go into the record ("E"), so uninstall removes exactly
    # what was added. A failure only warns: the install itself is complete.

    function Get-MdoDefaultAppKeys {
      "$ClassesKey\$ProgId"
      "$CapabilitiesKey"
      foreach ($ext in $PdfExtensions) { "$ClassesKey\$ext\OpenWithProgids" }
      "$CapabilitiesKey\FileAssociations"
      "$RegisteredApps"
    }

    function Test-OwnTag([string]$SubKey) {
      $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey)
      if ($null -eq $key) { return $false }
      try { return ([string]$key.GetValue('MarkdownOfficeBootstrap') -eq $DefaultAppTag) } finally { $key.Close() }
    }

    function Set-MdoKeyValues([string]$SubKey, [hashtable]$Values, [System.Collections.ArrayList]$Record) {
      $key = New-MdoRegKey $SubKey $Record
      try {
        foreach ($name in $Values.Keys) { $key.SetValue($name, $Values[$name]) }
      } finally {
        $key.Close()
      }
    }

    function Write-MdoDefaultApp([System.Collections.ArrayList]$Record) {
      try {
        foreach ($sub in @("$ClassesKey\$ProgId", $CapabilitiesKey)) {
          if ((Test-MdoKey $sub) -and -not (Test-OwnTag $sub)) {
            Write-Warn "HKCU\$sub stammt nicht von Markdown Office - als Programm fuer .md nicht eingetragen."
            return
          }
        }
        $prog = "$ClassesKey\$ProgId"
        Set-MdoKeyValues $prog @{ '' = 'Markdown-Notiz'; 'MarkdownOfficeBootstrap' = $DefaultAppTag } $Record
        Set-MdoKeyValues "$prog\DefaultIcon" @{ '' = "`"$Exe`",0" } $Record
        Set-MdoKeyValues "$prog\shell\open\command" @{ '' = "`"$Exe`" `"%1`"" } $Record
        foreach ($ext in $PdfExtensions) {
          $key = New-MdoRegKey "$ClassesKey\$ext\OpenWithProgids" $Record
          try { $key.SetValue($ProgId, [byte[]]@(), [Microsoft.Win32.RegistryValueKind]::None) } finally { $key.Close() }
        }
        Set-MdoKeyValues $CapabilitiesKey @{
          'ApplicationName' = $AppName
          'ApplicationDescription' = 'Markdown-Editor mit PDF-Export'
          'MarkdownOfficeBootstrap' = $DefaultAppTag
        } $Record
        $assoc = @{}
        foreach ($ext in $PdfExtensions) { $assoc[$ext] = $ProgId }
        Set-MdoKeyValues "$CapabilitiesKey\FileAssociations" $assoc $Record
        Set-MdoKeyValues $RegisteredApps @{ $AppName = $CapabilitiesKey } $Record
      } catch {
        Write-Warn "Als Programm fuer .md nicht eingetragen ($($_.Exception.Message)). Markdown Office ist trotzdem installiert."
      }
    }

    # Tagged keys and our values go; foreign ones stay. Keys the install created (record "E")
    # go only when empty again and only if they lie on the path to one of our keys.
    function Remove-MdoDefaultApp([string[]]$Lines) {
      $hkcu = [Microsoft.Win32.Registry]::CurrentUser
      foreach ($sub in @("$ClassesKey\$ProgId", $CapabilitiesKey)) {
        if (Test-OwnTag $sub) {
          try { $hkcu.DeleteSubKeyTree($sub, $false) } catch { Write-Warn "Schluessel bleibt: HKCU\$sub ($($_.Exception.Message))" }
        }
      }
      $values = @()
      foreach ($ext in $PdfExtensions) { $values += ,@("$ClassesKey\$ext\OpenWithProgids", $ProgId, '') }
      $values += ,@($RegisteredApps, $AppName, $CapabilitiesKey)
      foreach ($v in $values) {
        $key = $hkcu.OpenSubKey($v[0], $true)
        if ($null -eq $key) { continue }
        try {
          $names = @($key.GetValueNames())
          # RegisteredApplications only when it still points at our capabilities.
          if (($names -contains $v[1]) -and (($v[2] -eq '') -or ([string]$key.GetValue($v[1]) -eq $v[2]))) {
            $key.DeleteValue($v[1], $false)
          }
        } finally {
          $key.Close()
        }
      }
      $own = @(Get-MdoDefaultAppKeys)
      $created = @(@($Lines) | Where-Object { $_ -like 'E *' } | ForEach-Object { $_.Substring(2) } | Sort-Object -Property Length -Descending)
      foreach ($sub in $created) {
        $onPath = $false
        foreach ($k in $own) {
          if ($k -eq $sub -or $k.StartsWith("$sub\", [StringComparison]::OrdinalIgnoreCase)) { $onPath = $true }
        }
        if (-not $onPath) { continue }
        $key = $hkcu.OpenSubKey($sub)
        if ($null -eq $key) { continue }
        $empty = ($key.SubKeyCount -eq 0 -and $key.ValueCount -eq 0)
        $key.Close()
        if ($empty) {
          try { $hkcu.DeleteSubKey($sub, $false) } catch { Write-Warn "Leerer Schluessel bleibt: HKCU\$sub" }
        }
      }
    }

    function Test-MdoPath {
      $dirs = @($env:Path -split ';' | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') })
      if ($dirs -notcontains $WinApps.TrimEnd('\')) {
        Write-Warn "$WinApps ist nicht im PATH - der Befehl markdown-office wird so nicht gefunden."
        Write-Host '  In "Umgebungsvariablen fuer dieses Konto bearbeiten" bei Path ergaenzen:'
        Write-Host "  $WinApps"
      }
    }

    function Install-Mdo {
      if ((Test-Path -LiteralPath $InstallDir) -and -not (Test-MdoOwned $InstallDir)) {
        Stop-Foreign $InstallDir
      }
      # Read before the old folder (and the record in it) is replaced.
      $previousRecord = @(Read-MdoRecord)
      $tempDir = Join-Path ([IO.Path]::GetTempPath()) ('markdown-office-bootstrap-' + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $tempDir | Out-Null
      [void]$MdoCleanup.Add($tempDir)

      if ($env:MDO_ARCHIVE) {
        if (-not (Test-Path -LiteralPath $env:MDO_ARCHIVE -PathType Leaf)) { Stop-Mdo 2 "MDO_ARCHIVE nicht gefunden: $env:MDO_ARCHIVE" }
        $zip = $env:MDO_ARCHIVE
        Write-Step "Installiere aus lokalem Archiv $zip (ohne Pruefsumme)"
      } elseif ($Archive) {
        # The app downloaded and checked the release before quitting (owner, 2026-10-29: the
        # background download took a minute without feedback and the app was reopened
        # meanwhile). Checked again under the asset name of -Version; no network is used.
        $assetName = "markdown-office-$WantVersion-win-x64.zip"
        Write-Step "Installiere Markdown Office $WantVersion aus $Archive"
        Test-MdoArchive $Archive $Sums $assetName
        $zip = $Archive
      } else {
        $zip = Get-MdoDownload $tempDir
      }

      if (Test-Path -LiteralPath $InstallDir) {
        Write-Step "Aktualisiere $InstallDir"
      } else {
        Write-Step "Installiere nach $InstallDir"
      }
      $root = New-MdoStage $zip
      Install-MdoStage $root
      Write-MdoLauncher
      Write-MdoShortcut
      Write-MdoContextMenu $previousRecord
      Write-Ok "Markdown Office installiert: $InstallDir"
      Write-Ok "Befehl: $CmdPath"
      Write-Ok "Explorer: Rechtsklick auf eine .md-Datei -> $PdfAction (Windows 11: Weitere Optionen anzeigen)"
      Write-Ok 'Als Standard fuer .md: Einstellungen -> Standard-Apps -> Markdown Office (oder in Markdown Office: Einstellungen)'
      Test-MdoPath
      Write-Host 'Fertig. Editor: markdown-office --app [notiz.md] oder Startmenue -> Markdown Office; PDF: markdown-office notiz.md'
    }

    # --- Uninstall ------------------------------------------------------------

    function Remove-MdoEntry {
      if (Test-OwnLauncher) {
        Remove-Item -LiteralPath $CmdPath -Force
        Write-Step "Befehl entfernt: $CmdPath"
      } elseif (Test-Path -LiteralPath $CmdPath) {
        Write-Warn "$CmdPath stammt nicht von Markdown Office - bleibt."
      }
      if (Test-OwnShortcut) {
        Remove-Item -LiteralPath $Shortcut -Force
        Write-Step "Startmenue-Eintrag entfernt: $Shortcut"
      } elseif (Test-Path -LiteralPath $Shortcut) {
        Write-Warn "$Shortcut zeigt nicht auf Markdown Office - bleibt."
      }
    }

    function Uninstall-Mdo {
      if (-not (Test-Path -LiteralPath $InstallDir)) {
        Write-Host "Nichts zu deinstallieren: $InstallDir existiert nicht."
        Remove-MdoOld
        Remove-MdoEntry
        Remove-MdoContextMenu @()
        Remove-MdoDefaultApp @()
        return
      }
      if (-not (Test-MdoOwned $InstallDir)) { Stop-Foreign $InstallDir }
      # Read before the folder (and the record in it) is renamed and deleted.
      $record = @(Read-MdoRecord)
      # Rename first, before anything else is touched: it fails as a whole while the app
      # has files open, so a refusal changes nothing. Leftovers, launcher and shortcut go
      # only after the folder is gone.
      if (-not (Move-MdoDir $InstallDir $OldDir)) {
        Stop-Mdo 12 'Markdown Office laeuft noch - bitte beenden und erneut versuchen. Es wurde nichts entfernt.'
      }
      Write-Step "Loesche $InstallDir"
      try {
        Remove-MdoTree $OldDir
      } catch {
        Stop-Mdo 6 "Konnte $OldDir nicht vollstaendig loeschen ($($_.Exception.Message)). Bitte von Hand entfernen."
      }
      Remove-MdoOld
      Remove-MdoEntry
      Remove-MdoContextMenu $record
      Remove-MdoDefaultApp $record
      Write-Ok 'Markdown Office deinstalliert. Dokumente, Vorlagen-Sets, Snippets und Einstellungen bleiben unangetastet.'
    }

    # --- Main -----------------------------------------------------------------

    try {
      if ($Pre -and $WantVersion) { Stop-Mdo 2 '-Pre und -Version schliessen sich aus.' }
      if ($WantVersion -and $WantVersion -notmatch $VersionRegex) {
        Stop-Mdo 2 "Ungueltige Version $WantVersion (erwartet z. B. 26.10.0 oder 26.10.0-dev.1)."
      }
      if ($Archive -or $Sums) {
        if (-not ($Archive -and $Sums)) { Stop-Mdo 2 '-Archive und -Sums gehoeren zusammen.' }
        if (-not $WantVersion) { Stop-Mdo 2 '-Archive braucht -Version (die Version des Archivs).' }
        if ($Uninstall) { Stop-Mdo 2 '-Archive passt nicht zu -Uninstall.' }
        if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { Stop-Mdo 2 "Archiv nicht gefunden: $Archive" }
        if (-not (Test-Path -LiteralPath $Sums -PathType Leaf)) { Stop-Mdo 2 "SHA256SUMS nicht gefunden: $Sums" }
      }
      if ($Uninstall) {
        Uninstall-Mdo
      } else {
        try { Install-Mdo } finally { Remove-MdoTemp }
      }
    } catch {
      if ($_.Exception.Message -like "$MdoStopMessage*") { throw }
      Write-Host "Error: Unerwarteter Fehler: $($_.Exception.Message)" -ForegroundColor Red
      Remove-MdoTemp
      if ($MdoFromFile) { exit 11 }
      throw
    }
    # As a file, report success explicitly (a native command's exit code must not leak);
    # under irm | iex, exit would close the window.
    if ($MdoFromFile) { exit 0 }
  }
} finally {
  [Net.ServicePointManager]::SecurityProtocol = $MdoSavedTls
  Remove-Variable -Name MdoSavedTls -ErrorAction SilentlyContinue
}
