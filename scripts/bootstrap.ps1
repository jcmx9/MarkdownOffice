<#
.SYNOPSIS
  Ein-Zeiler-Bootstrap fuer Markdown Office (Windows).
.DESCRIPTION
  Installieren / Aktualisieren (neueste stabile Version):
    irm https://raw.githubusercontent.com/jcmx9/MarkdownOffice/main/scripts/bootstrap.ps1 | iex
  Vorabversion testen (neueste Pre-Release; kann aelter sein als die neueste stabile):
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/jcmx9/MarkdownOffice/dev/scripts/bootstrap.ps1))) -Pre
  Bestimmte Version:   ... -Version 26.10.0   (oder 26.10.0-dev.1)
  Deinstallieren:      ... -Uninstall

  Laedt das passende Archiv der GitHub-Release, prueft es gegen SHA256SUMS und
  installiert ohne Adminrechte nach %LOCALAPPDATA%\Markdown Office, legt den Befehl
  %LOCALAPPDATA%\Microsoft\WindowsApps\markdown-office.cmd und eine
  Startmenue-Verknuepfung an:
    markdown-office notiz.md [ziel.pdf] [Optionen]   PDF erzeugen (Pipeline)
    markdown-office --app [notiz.md ...]             Editor starten
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

      $expected = $null
      foreach ($line in (Get-Content -LiteralPath $sumsFile)) {
        $parts = $line.Trim() -split '\s+', 2
        if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $assetName) {
          $expected = $parts[0].ToLowerInvariant()
          break
        }
      }
      if (-not $expected) { Stop-Mdo 5 "SHA256SUMS enthaelt keinen Eintrag fuer $assetName." }
      $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($actual -ne $expected) {
        Stop-Mdo 5 "Pruefsumme falsch fuer $assetName (erwartet $expected, erhalten $actual) - nichts wurde veraendert."
      }
      Write-Ok 'Pruefsumme stimmt'
      return $zip
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
      $tempDir = Join-Path ([IO.Path]::GetTempPath()) ('markdown-office-bootstrap-' + [guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path $tempDir | Out-Null
      [void]$MdoCleanup.Add($tempDir)

      if ($env:MDO_ARCHIVE) {
        if (-not (Test-Path -LiteralPath $env:MDO_ARCHIVE -PathType Leaf)) { Stop-Mdo 2 "MDO_ARCHIVE nicht gefunden: $env:MDO_ARCHIVE" }
        $zip = $env:MDO_ARCHIVE
        Write-Step "Installiere aus lokalem Archiv $zip (ohne Pruefsumme)"
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
      Write-Ok "Markdown Office installiert: $InstallDir"
      Write-Ok "Befehl: $CmdPath"
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
        return
      }
      if (-not (Test-MdoOwned $InstallDir)) { Stop-Foreign $InstallDir }
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
      Write-Ok 'Markdown Office deinstalliert. Dokumente, Vorlagen-Sets, Snippets und Einstellungen bleiben unangetastet.'
    }

    # --- Main -----------------------------------------------------------------

    try {
      if ($Pre -and $WantVersion) { Stop-Mdo 2 '-Pre und -Version schliessen sich aus.' }
      if ($WantVersion -and $WantVersion -notmatch $VersionRegex) {
        Stop-Mdo 2 "Ungueltige Version $WantVersion (erwartet z. B. 26.10.0 oder 26.10.0-dev.1)."
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
