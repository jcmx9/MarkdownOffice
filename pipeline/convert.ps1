#requires -Version 5.1
<#
.SYNOPSIS
  Konvertiert eine oder mehrere Markdown-Dateien nach PDF/A-3b.
.DESCRIPTION
  Wird von markdown-office (cli.js) mit den .md-Dateien als Argumenten
  aufgerufen, auch beim Export aus dem Editor. Die PDF wird im selben
  Verzeichnis wie die Quelle abgelegt (oder am ausdruecklichen Ausgabepfad).
  Pandoc wird nicht benoetigt; die Markdown-Konvertierung macht cmarker in Typst.
  Laeuft immer unbeaufsichtigt: ein Fehler endet mit Exit 1, nie mit einer Rueckfrage.

  Layout (in der App wie in der Entwicklung gleich, siehe tests/dev-layout.sh):
    MDO_PIPELINE_ROOT  Ordner mit convert.ps1, lib\, vendor\, fonts\ und
                       bin\typst.exe (Standard: der Ordner dieses Skripts;
                       App: <resources>\pipeline)
    MDO_SETS_DIR       mitgelieferte Vorlagen-Sets als <name>\<name>.typ
                       (Standard: <MDO_PIPELINE_ROOT>\..\sets; App: <resources>\sets)
    MDO_VERSION        Version fuer --version und die PDF-Stichwoerter (Standard: dev)
    MDO_MANIFEST       Manifest des Wrappers (markdown-office, src/cli/stage.ts): welche
                       lokalen Dateien die Notiz ins PDF holen darf (Bilder, Logo, Profil).
                       Ohne: kein Export.

  Staging-Ordner (spiegelt build.sh): Typst liest nur einen frischen Ordner pro Export
  (--root), der genau die Notiz, die Dateien aus dem Manifest, das Set und die
  Pipeline-Bausteine (lib\, vendor\cmarker, mitex, mmdr) als Kopien enthaelt. Warum:
  Notiztext kann Typst-Code ausfuehren (raw-typst in eigenen Sets, mitex-Durchreichungen
  wie \text{\label{#read(...)}}); mit dem Laufwerk als --root laese er jede lokale Datei
  ins PDF. Die Pakete (--package-*) und Fonts bleiben ausserhalb, Typst liest sie nur ueber
  diese Pfade. Nebenbei entfaellt die Bereitstellung fuer Dateien auf anderen Laufwerken:
  alles liegt im Staging-Ordner.

  Hinweis: Diese Datei muss reines ASCII bleiben (kein BOM) - Windows
  PowerShell 5.1 liest sie sonst in CP1252 falsch.

  Bewusst OHNE param()-Block: die Argumente werden selbst aus $args gelesen.
  Mit PowerShell-Parameterbindung ([CmdletBinding()]) wuerden POSIX-Optionen
  wie --no-source oder --hard-breaks (so rufen andere Programme auf, z. B.
  der Editor) als unbekannte Parameternamen abgelehnt.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Umgeleitete Ausgabe (der Editor liest stdout/stderr als UTF-8) in UTF-8 ohne
# BOM schreiben, sonst kommen Umlaute aus Pfaden in der OEM-Codepage an. In
# einer Konsole ohne Umleitung bleibt alles, wie es ist: PowerShell schreibt
# dort Unicode, und die Codepage der Konsole des Aufrufers bleibt unveraendert.
if ([Console]::IsOutputRedirected -or [Console]::IsErrorRedirected) {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
}

# Pipeline-Ordner und mitgelieferte Sets (siehe Kopfkommentar). Relative Werte
# gelten ab dem Arbeitsordner des Aufrufers.
$PipelineRoot = if ($env:MDO_PIPELINE_ROOT) {
  [IO.Path]::GetFullPath([IO.Path]::Combine((Get-Location).Path, $env:MDO_PIPELINE_ROOT))
} else { $PSScriptRoot }
$PipelineRoot = $PipelineRoot.TrimEnd('\', '/')
$SetsDir = if ($env:MDO_SETS_DIR) {
  [IO.Path]::GetFullPath([IO.Path]::Combine((Get-Location).Path, $env:MDO_SETS_DIR))
} else { [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $PipelineRoot) 'sets')) }
$FontDir     = Join-Path $PipelineRoot 'fonts'
# Typst: TYPST, sonst das mitgelieferte bin\typst.exe, sonst typst aus dem PATH.
$TypstExe = 'typst'
if ($env:TYPST) { $TypstExe = $env:TYPST }
elseif (Test-Path -LiteralPath (Join-Path $PipelineRoot 'bin\typst.exe') -PathType Leaf) {
  $TypstExe = Join-Path $PipelineRoot 'bin\typst.exe'
}
# Eigene Vorlagen-Sets: MDO_TEMPLATES, sonst "Eigene Dokumente"\Markdown Office\Vorlagen
# (der Windows-Ordner "Dokumente", auch wenn OneDrive ihn umleitet).
# GetFolderPath liefert '' (statt Fehler), wenn der Ordner fehlt (Dienstkonten).
$docsDir = [Environment]::GetFolderPath('MyDocuments')
$UserTemplates = ''  # unten gesetzt, nach ConvertTo-FullPath

# ---------------------------------------------------------------------------
# CLI-Flags: -Version / -Help (PowerShell-nativ) sowie zusaetzlich die POSIX-
# Formen --version/-V und --help/-h, damit 'markdown-office --version' plattform-
# gleich wie unter macOS/Linux funktioniert (spiegelt build.sh).
# ---------------------------------------------------------------------------
$MdoVersion = if ($env:MDO_VERSION) { $env:MDO_VERSION } else { 'dev' }

function Show-MdoHelp {
  Write-Host @"
markdown-office $MdoVersion - Markdown -> Corporate PDF/A-3b (via Typst, kein Pandoc)

Usage:
  markdown-office [OPTIONS] SOURCE.md [SOURCE.md ...]
  markdown-office [OPTIONS] SOURCE.md OUTPUT.pdf
  markdown-office --app [notiz.md ...]    Editor oeffnen

Arguments:
  SOURCE.md    Zu rendernde Markdown-Quelle(n) (ohne Angabe: diese Hilfe). Die PDF
               landet neben der Quelle; ein 'date:' im Frontmatter stellt das
               ISO-Datum voran (z.B. 2026-06-19_SOURCE.pdf) - abschaltbar mit
               'isodate_praefix: false'.
  OUTPUT.pdf   Bei genau einer Quelle: Ausgabepfad, wird exakt so geschrieben.

Options:
  --hard-breaks         Jede Zeile bleibt eine Zeile, wie im Editor getippt
                        (Standard; Frontmatter: hard_breaks: true)
  --soft-breaks         Einzelne Zeilenumbrueche werden zu Leerzeichen (CommonMark;
                        Frontmatter: hard_breaks: false)
  --no-source           Markdown-Quelle NICHT ins PDF einbetten (Kunden-PDFs;
                        Frontmatter: embed_source: false)
  --template NAME|DATEI.typ
                        Vorlagen-Set (Name) oder einzelne .typ-Datei; gewinnt
                        ueber den Frontmatter-Schluessel template: (Standard: memo)
  -Version, --version   markdown-office- und Typst-Version ausgeben und beenden
  -Help,    --help      Diese Hilfe ausgeben und beenden

Optionale YAML-Frontmatter-Schluessel:
  title, subtitle, toptitle, author, date, isodate_praefix, toc, h1_break,
  print_filename, lang, header, watermark, logo, logo-height, profile,
  embed_source, hard_breaks, template

Environment:
  MDO_NO_OPEN=1             Das PDF nach dem Build nicht oeffnen (Batch/Cron)
  MDO_BASE_DIR=ordner       Relative Bild-/Logopfade gelten relativ zu diesem Ordner
                            statt zum Ordner der Quelle (temporaere Kopie)
  MDO_TEMPLATES=ordner      Ordner mit eigenen Vorlagen-Sets (Standard:
                            Dokumente\Markdown Office\Vorlagen)
  MDO_PIPELINE_ROOT=ordner  Pipeline-Ordner mit lib\, vendor\, fonts\, bin\typst.exe
                            (Standard: Ordner dieses Skripts)
  MDO_SETS_DIR=ordner       Mitgelieferte Vorlagen-Sets (Standard: ..\sets)
  MDO_VERSION=version       Versionsangabe (Standard: dev)
  MDO_MANIFEST=datei        Export-Manifest; setzt markdown-office (ohne: kein Export)
  TYPST=pfad                Bestimmtes typst-Binary verwenden (>= 0.15 erforderlich)
"@
}

# Argumente selbst auswerten (siehe Kopfkommentar): Optionen in POSIX- und
# PowerShell-Schreibweise, alles andere sind Pfade. Eine unbekannte Option
# endet wie in build.sh mit Exit 2; '--' beendet die Optionen (danach sind
# alle Argumente Pfade, auch solche mit fuehrendem '-').
$Version = $false; $Help = $false; $NoSource = $false; $HardBreaks = $false; $SoftBreaks = $false
$CliTemplate = ''
$Path = @()
$argv = @($args)
$endOfOptions = $false
for ($i = 0; $i -lt $argv.Count; $i++) {
  $arg = [string]$argv[$i]
  if ($endOfOptions) { $Path += $arg; continue }
  switch -CaseSensitive ($arg) {
    '--'            { $endOfOptions = $true; continue }
    { $_ -in @('--version', '-V', '-Version', '-version') } { $Version = $true; continue }
    { $_ -in @('--help', '-h', '-Help', '-help', '-?') }    { $Help = $true; continue }
    '--no-source'   { $NoSource = $true; continue }
    '--hard-breaks' { $HardBreaks = $true; continue }
    '--soft-breaks' { $SoftBreaks = $true; continue }
    { $_ -in @('--template', '-Template') } {
      if ($i + 1 -ge $argv.Count -or -not [string]$argv[$i + 1]) {
        [Console]::Error.WriteLine('Error: --template braucht einen Set-Namen oder eine .typ-Datei')
        exit 2
      }
      $i++
      $CliTemplate = [string]$argv[$i]
      continue
    }
    { $_.StartsWith('--template=') } {
      $CliTemplate = $arg.Substring('--template='.Length)
      if (-not $CliTemplate) {
        [Console]::Error.WriteLine('Error: --template braucht einen Set-Namen oder eine .typ-Datei')
        exit 2
      }
      continue
    }
    default {
      if ($arg.StartsWith('-')) {
        [Console]::Error.WriteLine("Error: unbekannte Option $arg")
        [Console]::Error.WriteLine('Aufruf: markdown-office --help')
        exit 2
      }
      $Path += $arg
    }
  }
}

if ($Version) {
  Write-Host "markdown-office $MdoVersion"
  if (Get-Command $TypstExe -ErrorAction SilentlyContinue) { & $TypstExe --version }
  exit 0
}
if ($Help) { Show-MdoHelp; exit 0 }

# Ohne Quelle: Hilfe statt einer Standardquelle, nichts wird geschrieben
# (Paritaet zu build.sh; der Pipeline-Ordner der App bleibt unberuehrt).
if (-not $Path -or $Path.Count -eq 0) { Show-MdoHelp; exit 0 }
# Pfad aus der Befehlszeile absolut machen. [IO.Path]::Combine statt
# Join-Path: Combine uebernimmt einen absoluten zweiten Pfad unveraendert,
# Join-Path haengt ihn an ("C:\Notizen\C:\...\notiz.pdf" -> GetFullPath:
# "Das angegebene Pfadformat wird nicht unterstuetzt"). Andere Programme
# uebergeben Ein- und Ausgabe meist absolut, oft mit Leerzeichen.
function ConvertTo-FullPath {
  param([string]$P)
  return [IO.Path]::GetFullPath([IO.Path]::Combine((Get-Location).Path, $P))
}
# Relatives MDO_TEMPLATES gilt ab dem Arbeitsordner des Aufrufers (Paritaet zu build.sh).
if ($env:MDO_TEMPLATES) { $UserTemplates = ConvertTo-FullPath $env:MDO_TEMPLATES }
elseif ($docsDir) { $UserTemplates = Join-Path $docsDir 'Markdown Office\Vorlagen' }

# Genau zwei Argumente, das zweite eine .pdf: ausdruecklicher Ausgabepfad
# (Paritaet zu 'build.sh SOURCE.md OUTPUT.pdf', z. B. fuer den Export aus einem Editor).
$ExplicitOut = ''
if ($Path.Count -eq 2 -and [IO.Path]::GetExtension($Path[1]) -eq '.pdf') {
  $ExplicitOut = ConvertTo-FullPath $Path[1]
  $Path = @($Path[0])
}

# Einen YAML-Skalar zu 'true'/'false' normalisieren (YAML-1.1-Boolean-Menge,
# Obsidian-kompatibel; Superset von YAML 1.2). Akzeptiert true/false/yes/no/on/
# off/y/n in beliebiger Gross-/Kleinschreibung, entfernt umschliessende Quotes
# und einen Inline-Kommentar (' # ...'). Unbekannte Werte -> $null (Aufrufer warnt).
function ConvertTo-YamlBool {
  param([string]$Raw)
  $v = ($Raw -replace '\s#.*$', '').Trim().Trim('"', "'").ToLower()
  if ($v -in @('true', 'yes', 'on', 'y'))  { return 'true' }
  if ($v -in @('false', 'no', 'off', 'n')) { return 'false' }
  return $null
}

# Einen YAML-String-Skalar saeubern (spiegelt yaml_str in build.sh): in
# Anfuehrungszeichen gilt der Inhalt bis zum schliessenden Zeichen, sonst wird
# ein Inline-Kommentar (' # ...') abgeschnitten. Eine Inline-Liste [a, "b"]
# wird zu "a, b" (z. B. mehrere Autoren).
function ConvertTo-YamlStr {
  param([string]$Raw)
  $v = $Raw.Trim()
  if ($v -match '^"([^"]*)') { return $Matches[1] }
  if ($v -match "^'([^']*)") { return $Matches[1] }
  if ($v -match '^\[([^\]]*)') {
    return (($Matches[1] -replace '["'']', '') -split '\s*,\s*' |
      ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join ', '
  }
  return ($v -replace '\s#.*$', '').Trim()
}

# Bool-Schluessel auswerten (spiegelt fm_bool in build.sh): 'true'/'false'
# (bzw. 'auto', wenn erlaubt). Leerer Wert -> $null ohne Warnung; ungueltiger
# Wert -> Warnung + $null, der Default bleibt.
function Get-FmBool {
  param([string]$Key, [string]$Raw, [switch]$AllowAuto)
  $v = ConvertTo-YamlStr $Raw
  if (-not $v) { return $null }
  if ($AllowAuto -and $v.ToLower() -eq 'auto') { return 'auto' }
  $b = ConvertTo-YamlBool $v
  if ($b) { return $b }
  $allowed = if ($AllowAuto) { 'true/false/auto' } else { 'true/false' }
  Write-Warning "Ungueltiger Wert fuer '$Key': '$v' - ignoriert ($allowed)."
  return $null
}

# Umgebungsvariable lesen; USER<->USERNAME und HOME<->USERPROFILE als Rueckfall.
function Get-EnvFallback {
  param([string]$Name)
  $v = [Environment]::GetEnvironmentVariable($Name)
  if (-not $v) {
    $alt = @{ USER = 'USERNAME'; USERNAME = 'USER'; HOME = 'USERPROFILE'; USERPROFILE = 'HOME' }[$Name]
    if ($alt) { $v = [Environment]::GetEnvironmentVariable($alt) }
  }
  if (-not $v) { $v = '' }
  return $v
}

# Pfad aus einer Notiz aufbereiten (spiegelt expand_path in build.sh): ~,
# ${VAR}, $VAR und %VAR% ersetzen, %XX-Kodierung aufloesen. Nichts wird
# ausgefuehrt, nur Variablen eingesetzt.
function Expand-NotePath {
  param([string]$P)
  if ($P -eq '~' -or $P -match '^~[\\/]') { $P = (Get-EnvFallback 'HOME') + $P.Substring(1) }
  $P = [regex]::Replace($P, '\$\{([A-Za-z_][A-Za-z0-9_]*)\}', { param($m) Get-EnvFallback $m.Groups[1].Value })
  $P = [regex]::Replace($P, '\$([A-Za-z_][A-Za-z0-9_]*)', { param($m) Get-EnvFallback $m.Groups[1].Value })
  $P = [regex]::Replace($P, '%([A-Za-z_][A-Za-z0-9_]*)%', { param($m) Get-EnvFallback $m.Groups[1].Value })
  $P = [regex]::Replace($P, '%([0-9A-Fa-f]{2})', { param($m) [string][char][Convert]::ToInt32($m.Groups[1].Value, 16) })
  return $P
}

# Frontmatter-Datum (ISO 2026-10-13 oder deutsch 13.10.2026) -> ISO; sonst ''.
function ConvertTo-IsoDate {
  param([string]$D)
  if ($D -match '^(\d{4})-(\d{1,2})-(\d{1,2})$') { return ('{0}-{1:D2}-{2:D2}' -f $Matches[1], [int]$Matches[2], [int]$Matches[3]) }
  if ($D -match '^(\d{1,2})\.(\d{1,2})\.(\d{4})$') { return ('{0}-{1:D2}-{2:D2}' -f $Matches[3], [int]$Matches[2], [int]$Matches[1]) }
  return ''
}

# Kein Netz, nie (2/2, spiegelt build.sh): was der Textscan der Vorlage nicht sieht (z. B.
# eine per Verkettung gebaute Paketangabe), stoppt ein unerreichbarer Proxy fuer die
# Typst-Aufrufe; ein Download scheitert, bevor etwas in die Ablage geschrieben wird.
# NO_PROXY leer: keine Ausnahmen. Ohne jede TYPST_*-Variable (Wurzel, Paket- und Font-Pfade,
# Zertifikat von aussen), wie die Formelvorschau der App (src/main/math.ts mathEnv).
# Enable-NoNetwork setzt die Variablen NUR um einen Typst-Aufruf herum und gibt die alten Werte
# zurueck; Restore-Network stellt sie in einem finally wieder her, damit weder der
# PDF-Betrachter (Start-Process) noch ein Aufrufer im selben Prozess sie erbt. (Unter Windows
# sind HTTPS_PROXY und https_proxy dieselbe Variable; das Speichern in fester Reihenfolge und
# Wiederherstellen in umgekehrter Reihenfolge stellt den urspruenglichen Wert her.)
$script:NoNetVars = @('HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy',
  'NO_PROXY', 'no_proxy')
function Enable-NoNetwork {
  $saved = [ordered]@{}
  $typstVars = @([Environment]::GetEnvironmentVariables('Process').Keys |
    ForEach-Object { [string]$_ } | Where-Object { $_ -match '^TYPST_' })
  foreach ($v in @($script:NoNetVars + $typstVars)) {
    if (-not $saved.Contains($v)) { $saved[$v] = [Environment]::GetEnvironmentVariable($v, 'Process') }
  }
  foreach ($v in $typstVars) { [Environment]::SetEnvironmentVariable($v, $null, 'Process') }
  foreach ($v in $script:NoNetVars) {
    $val = if ($v -like '*no_proxy') { $null } else { 'http://127.0.0.1:9' }
    [Environment]::SetEnvironmentVariable($v, $val, 'Process')
  }
  return $saved
}
function Restore-Network {
  param($Saved)
  if (-not $Saved) { return }
  $names = @($Saved.Keys)
  [array]::Reverse($names)
  foreach ($v in $names) { [Environment]::SetEnvironmentVariable($v, $Saved[$v], 'Process') }
}

# Ein Symlink oder eine Junction (auch ein Laufwerk im Ordner)? Andere Reparse-Punkte, etwa
# OneDrive-Platzhalter in einem umgeleiteten Dokumente-Ordner, sind keine Links: ihr Inhalt
# liegt an dieser Stelle.
function Test-LinkItem {
  param($Item)
  return [bool](($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
    ($Item.LinkType -in @('SymbolicLink', 'Junction')))
}

# Pfad mit allen Symlinks und Junctions aufgeloest (spiegelt real_path in build.sh; Windows
# PowerShell 5.1 und .NET Framework haben dafuer keine Funktion): Teil fuer Teil ab der Wurzel,
# ein Link wird durch sein Ziel ersetzt (ein relatives ab seinem Ordner). $null bei einem
# fehlenden Teil, einem Link ohne Ziel oder mehr als 40 Links (Schleife).
function Resolve-RealPath {
  param([string]$P)
  try { $p = [IO.Path]::GetFullPath($P) } catch { return $null }
  for ($hops = 0; $hops -le 40; $hops++) {
    $root = [IO.Path]::GetPathRoot($p)
    if (-not $root) { return $null }
    $parts = @($p.Substring($root.Length).Split([char[]]@('\', '/'), [StringSplitOptions]::RemoveEmptyEntries))
    $cur = $root
    $relinked = $false
    for ($k = 0; $k -lt $parts.Count; $k++) {
      $next = [IO.Path]::Combine($cur, $parts[$k])
      $item = Get-Item -LiteralPath $next -Force -ErrorAction SilentlyContinue
      if (-not $item) { return $null }
      if (Test-LinkItem $item) {
        $target = [string](@($item.Target) | Where-Object { $_ } | Select-Object -First 1)
        if (-not $target) { return $null }
        if ($target.StartsWith('\??\')) { $target = $target.Substring(4) }
        if (-not [IO.Path]::IsPathRooted($target)) { $target = [IO.Path]::Combine($cur, $target) }
        $p = $target
        for ($j = $k + 1; $j -lt $parts.Count; $j++) { $p = [IO.Path]::Combine($p, $parts[$j]) }
        try { $p = [IO.Path]::GetFullPath($p) } catch { return $null }
        $relinked = $true
        break
      }
      $cur = $next
    }
    if (-not $relinked) { return $cur }
  }
  return $null
}

# Der Teil von $Real unterhalb von $Root (beide aufgeloest), sonst $null. Gross- und
# Kleinschreibung zaehlen unter Windows nicht.
function Get-RelativeUnder {
  param([string]$Real, [string]$Root)
  $r = $Root.TrimEnd('\', '/') + '\'
  if (-not $Real.StartsWith($r, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  $rel = $Real.Substring($r.Length)
  if (-not $rel) { return $null }
  return $rel
}

# Beginnt ein Teil des relativen Pfads mit '.' (.ssh, .config, .git ...)?
function Test-DotSegment {
  param([string]$Rel)
  return [bool](@($Rel.Split([char[]]@('\', '/')) | Where-Object { $_.StartsWith('.') }).Count)
}

# Heisst ein Teil des relativen Pfads profiles (dort liegen die Profile aller Absender)?
function Test-ProfilesSegment {
  param([string]$Rel)
  return [bool](@($Rel.Split([char[]]@('\', '/')) | Where-Object { $_ -eq 'profiles' }).Count)
}

# Zahl der Namen (harten Links) einer Datei; 0, wenn sie sich nicht ermitteln laesst (dann gilt
# die Datei als abgewiesen, wie build.sh mit stat). .NET Framework kennt die Zahl nicht, daher
# GetFileInformationByHandle; der Typ wird erst hier uebersetzt (nur fuer eine von der Notiz
# genannte Vorlage, kein Aufwand bei jedem Export).
function Get-LinkCount {
  param([string]$File)
  try {
    if (-not ('MdoNative.LinkCount' -as [type])) {
      Add-Type -Namespace MdoNative -Name LinkCount -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct Info {
  public uint FileAttributes;
  public uint CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh;
  public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
}
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetFileInformationByHandle(Microsoft.Win32.SafeHandles.SafeFileHandle file, out Info info);
'@
    }
    $fs = [IO.File]::Open($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]'ReadWrite, Delete')
    try {
      $info = New-Object 'MdoNative.LinkCount+Info'
      if (-not [MdoNative.LinkCount]::GetFileInformationByHandle($fs.SafeFileHandle, [ref]$info)) { return 0 }
      return [int]$info.NumberOfLinks
    } finally { $fs.Dispose() }
  } catch { return 0 }
}

# Eine .typ, die die Notiz selbst nennt (template: ./x.typ, ~, %VAR%, absolut), laeuft mit der
# Notiz im Staging-Ordner (spiegelt note_template_ok in build.sh). Sie muss daher eine echte
# Datei sein (kein Symlink, kein harter Link: ein zweiter Name derselben Datei kann eine fremde
# Datei sein), auf .typ enden und aufgeloest unter einem der Ordner $Roots liegen (Ordner der
# Notiz, MDO_BASE_DIR, Vorlagen-Ordner), ohne Punkt-Ordner darunter. Warum: `template:
# ./evil.typ` als Link auf eine Datei unter .ssh oder ein verlinkter Ordner braechte jede lokale
# Datei ins PDF. Die Entscheidung trifft der Wrapper (src/cli/stage.ts templateFile); dies prueft
# dieselbe Regel noch einmal.
function Test-NoteTemplate {
  param([string]$File, [string[]]$Roots)
  $item = Get-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue
  if (-not $item -or $item.PSIsContainer) { return $false }
  if ((Test-LinkItem $item) -or $item.LinkType) { return $false }
  if ((Get-LinkCount $item.FullName) -ne 1) { return $false }
  # Kein 8.3-Kurzname (RUNNER~1) im Pfad: die Vergleiche unten sind textuell und erweitern
  # Kurznamen nicht (Abwehr in der Tiefe; der Wrapper vergleicht aufgeloeste Pfade).
  if (@($item.FullName.Split([char[]]@('\', '/')) | Where-Object { $_ -match '~\d' }).Count) { return $false }
  $dir = Resolve-RealPath (Split-Path -Parent $item.FullName)
  if (-not $dir) { return $false }
  $real = [IO.Path]::Combine($dir, $item.Name)
  if (@($real.Split([char[]]@('\', '/')) | Where-Object { $_ -match '~\d' }).Count) { return $false }
  if ([IO.Path]::GetExtension($real) -ne '.typ') { return $false }
  foreach ($root in $Roots) {
    if (-not $root) { continue }
    $rr = Resolve-RealPath $root
    if (-not $rr) { continue }
    $rel = Get-RelativeUnder $real $rr
    if ($null -eq $rel -or (Test-DotSegment $rel)) { continue }
    return $true
  }
  return $false
}

# Der Ordner einer einzelnen, ueber den Set-Namen gefundenen .typ (Vorlagen\meinset.typ), damit
# sie Nachbardateien einbinden kann (spiegelt stage_folder in build.sh; Entscheidung des
# Besitzers, 2026-10-24). Der Ordner ist meist der Vorlagen-Ordner selbst; daher bleiben draussen:
# jeder Ordner namens profiles (in jeder Tiefe; dort liegen die Profile aller Absender), jeder
# Eintrag, dessen Name mit . beginnt, und jeder Symlink, dessen Ziel den Ordner $RealRoot
# verlaesst. Ein Symlink auf eine Datei im Ordner wird als Inhalt kopiert; ein Ordner-Link oder
# eine Junction wird nie verfolgt (er umginge die Ausnahmen).
function Copy-StageFolder {
  param([string]$Src, [string]$Dest, [string]$RealRoot)
  foreach ($e in @(Get-ChildItem -LiteralPath $Src -Force -ErrorAction Stop)) {
    if ($e.Name.StartsWith('.')) { continue }
    $to = Join-Path $Dest $e.Name
    if (Test-LinkItem $e) {
      if ($e.PSIsContainer) { continue }
      $r = Resolve-RealPath $e.FullName
      if (-not $r) { continue }
      $rel = Get-RelativeUnder $r $RealRoot
      if ($null -eq $rel -or (Test-DotSegment $rel) -or (Test-ProfilesSegment $rel)) { continue }
      if (-not (Test-Path -LiteralPath $r -PathType Leaf)) { continue }
      [IO.File]::Copy($r, $to, $true)
    } elseif ($e.PSIsContainer) {
      if ($e.Name -eq 'profiles') { continue }
      [void][IO.Directory]::CreateDirectory($to)
      Copy-StageFolder $e.FullName $to $RealRoot
    } else {
      [IO.File]::Copy($e.FullName, $to, $true)
    }
  }
}

# Ein vertrauenswuerdiger Ordner (Set-Ordner, lib\, vendor\...) in den Staging-Ordner; Links darin
# werden wie bisher verfolgt (ein Set-Repo als Link im Vorlagen-Ordner). $Dest darf noch nicht
# bestehen (Copy-Item legt ihn dann als Kopie von $Src an, statt $Src hineinzulegen).
function Copy-Trusted {
  param([string]$Src, [string]$Dest)
  Copy-Item -LiteralPath $Src -Destination $Dest -Recurse -Force -ErrorAction Stop
}

# Frischer, privater Staging-Ordner im Temp-Ordner des Benutzers (nie neben der Notiz, nie im
# Pipeline-Ordner): mdo-stage-<guid> mit der Marke .mdo-stage, die den Wrapper einen Ordner
# wegraeumen laesst, den ein hartes Beenden zurueckliess. Zugriff nur fuer den angemeldeten
# Benutzer (wie chmod 700 in build.sh; ohne vererbte Rechte); geht das nicht, bleibt es beim
# Temp-Ordner des Benutzers, der ohnehin nur ihm gehoert.
function New-StageDir {
  $base = [IO.Path]::GetTempPath()
  for ($try = 0; $try -lt 5; $try++) {
    $d = Join-Path $base ('mdo-stage-' + [Guid]::NewGuid().ToString('N'))
    if (Test-Path -LiteralPath $d) { continue }
    try {
      $sec = New-Object Security.AccessControl.DirectorySecurity
      $sec.SetAccessRuleProtection($true, $false)
      $me = [Security.Principal.WindowsIdentity]::GetCurrent().User
      $sec.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($me, 'FullControl',
            'ContainerInherit, ObjectInherit', 'None', 'Allow')))
      [void][IO.Directory]::CreateDirectory($d, $sec)
    } catch {
      Write-Verbose "Zugriffsrechte des Staging-Ordners nicht setzbar ($($_.Exception.Message)): $d"
      [void][IO.Directory]::CreateDirectory($d)
    }
    [IO.File]::WriteAllText((Join-Path $d '.mdo-stage'), '')
    return $d
  }
  throw "Staging-Ordner nicht anlegbar in $base"
}

# Staging-Ordner entfernen, ohne je einem Link zu folgen (Windows PowerShell 5.1 Remove-Item
# -Recurse loescht durch eine Junction hindurch auch das Ziel). Schreibgeschuetzte Kopien werden
# vorher freigegeben. Scheitert es, bleibt der Ordner mit seiner Marke fuer den Wrapper.
function Remove-StageTree {
  param([IO.DirectoryInfo]$Dir, [string]$Keep = '')
  foreach ($e in $Dir.GetFileSystemInfos()) {
    if ($Keep -and $e.Name -eq $Keep) { continue }
    if ($e.Attributes -band [IO.FileAttributes]::ReadOnly) {
      $e.Attributes = $e.Attributes -band -bnot [IO.FileAttributes]::ReadOnly
    }
    if (($e.Attributes -band [IO.FileAttributes]::Directory) -and
        -not ($e.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      Remove-StageTree ([IO.DirectoryInfo]$e)
    } else {
      # Eine Datei oder ein Link (nur der Link selbst wird entfernt, nie sein Ziel).
      $e.Delete()
    }
  }
  if (-not $Keep) { $Dir.Delete() }
}
# Die Marke zuletzt: scheitert das Loeschen mittendrin, bleibt ein markierter Ordner, den der
# Wrapper spaeter wegraeumt (ohne Marke bliebe er mit Kopien der Notiz, der Bilder und der
# Unterschrift fuer immer liegen).
function Remove-StageDir {
  param([string]$Dir)
  if (-not $Dir) { return }
  try {
    $info = New-Object IO.DirectoryInfo $Dir
    if ($info.Exists) {
      Remove-StageTree $info '.mdo-stage'
      $marker = New-Object IO.FileInfo (Join-Path $Dir '.mdo-stage')
      if ($marker.Exists) { $marker.Attributes = [IO.FileAttributes]::Normal; $marker.Delete() }
      $info.Delete()
    }
  } catch {
    Write-Verbose "Staging-Ordner nicht entfernt: $Dir"
  }
}

# Manifest lesen (JSON, vom Wrapper geschrieben und geprueft; spiegelt build.sh). Werte mit
# Steuerzeichen entfallen (ein solches Bild fehlt dann nur), ebenso Pfade, die nicht absolut
# sind. Logo und Profil kommen NUR von hier: eigene Suchen nach Pfaden aus der Notiz wuerden
# wieder beliebige Dateien in den Staging-Ordner holen. Strict Mode: fehlende Felder ueber
# Get-JsonValue lesen, nie als Eigenschaft.
function Get-JsonValue {
  param($Obj, [string]$Name)
  if ($Obj -isnot [Management.Automation.PSCustomObject]) { return $null }
  $prop = $Obj.PSObject.Properties[$Name]
  if ($prop) { return $prop.Value }
  return $null
}
function Test-PlainValue {
  param($V)
  return [bool](($V -is [string]) -and $V.Length -gt 0 -and $V -notmatch '[\x00-\x1f\x7f]')
}
function Test-AbsValue {
  param($V)
  return [bool]((Test-PlainValue $V) -and $V -match '^([A-Za-z]:[\\/]|[\\/]{2})')
}
function Read-ExportManifest {
  param([string]$File)
  try {
    $m = [IO.File]::ReadAllText($File, (New-Object Text.UTF8Encoding $false)) | ConvertFrom-Json
  } catch { throw "Export-Manifest nicht lesbar: $File" }
  $r = @{ Note = ''; Refs = @(); Paths = @(); Logo = ''; Profile = ''; ProfileFiles = @() }
  $note = Get-JsonValue $m 'note'
  if (Test-AbsValue $note) { $r.Note = [string]$note }
  foreach ($i in @(Get-JsonValue $m 'images')) {
    $ref = Get-JsonValue $i 'ref'
    $path = Get-JsonValue $i 'path'
    if ((Test-PlainValue $ref) -and (Test-AbsValue $path)) {
      $r.Refs += [string]$ref
      $r.Paths += [string]$path
    }
  }
  $logo = Get-JsonValue $m 'logo'
  if (Test-AbsValue $logo) { $r.Logo = [string]$logo }
  $prof = Get-JsonValue $m 'profile'
  $yaml = Get-JsonValue $prof 'yaml'
  if (Test-AbsValue $yaml) {
    $r.Profile = [string]$yaml
    foreach ($f in @(Get-JsonValue $prof 'files')) {
      if (Test-AbsValue $f) { $r.ProfileFiles += [string]$f }
    }
  }
  return $r
}

# Ein JSON-String-Literal (fuer images.json; wie json_escape in build.sh, dazu Steuerzeichen als
# \uXXXX). Von Hand statt ConvertTo-Json: das Ergebnis haengt so nicht von der Version ab.
function ConvertTo-JsonString {
  param([string]$S)
  $v = $S.Replace('\', '\\').Replace('"', '\"')
  $v = [regex]::Replace($v, '[\x00-\x1f]', { param($c) '\u{0:x4}' -f [int][char]$c.Value })
  return '"' + $v + '"'
}

# Vorlage aufloesen (spiegelt resolve_template in build.sh): leer -> memo;
# ein Name (a-z, 0-9, _ und -) ist ein Set (Benutzerordner <name>.typ oder
# <name>\<name>.typ vor den mitgelieferten Sets <MDO_SETS_DIR>\<name>\<name>.typ); ein Wert auf .typ eine
# einzelne Datei relativ zu $Base. -FromNote (der Wert steht in der Notiz): ein UNC- oder
# Geraetepfad (\\server\x, //server/x) gilt als nicht gefunden, ohne ihn anzufassen - schon das
# Nachsehen liesse Windows per SMB den Server kontaktieren und dabei den NTLM-Hash des Nutzers
# preisgeben (wie remoteWinPath im Wrapper, src/cli/stage.ts).
function Resolve-Template {
  param([string]$Value, [string]$Base, [switch]$FromNote)
  if (-not $Value) { $Value = 'memo' }
  if ($Value -cmatch '^[a-z0-9_-]+$') {
    # Benutzerordner zuerst: <name>.typ, dann ein Set-Ordner <name>\<name>.typ (geklontes
    # oder aus dem Katalog installiertes Set-Repo), danach die mitgelieferten Sets.
    $cands = @()
    if ($UserTemplates) {
      $cands += (Join-Path $UserTemplates "$Value.typ")
      $cands += (Join-Path (Join-Path $UserTemplates $Value) "$Value.typ")
    }
    $cands += (Join-Path (Join-Path $SetsDir $Value) "$Value.typ")
    foreach ($cand in $cands) {
      if (Test-Path -LiteralPath $cand -PathType Leaf) { return $cand }
    }
    $searched = (@($UserTemplates, $SetsDir) | Where-Object { $_ }) -join ' und '
    throw "Vorlage nicht gefunden: $Value (gesucht in $searched)"
  }
  if ($Value -match '\.typ$') {
    $p = Expand-NotePath $Value
    if ($FromNote -and $p -match '^[\\/]{2}') { throw "Vorlage nicht gefunden: $Value" }
    if (-not [IO.Path]::IsPathRooted($p)) { $p = [IO.Path]::Combine($Base, $p) }
    $p = [IO.Path]::GetFullPath($p)
    if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
    throw "Vorlage nicht gefunden: $Value"
  }
  throw "ungueltige Vorlage: $Value (erlaubt: Set-Name aus a-z, 0-9, _ und - oder eine .typ-Datei)"
}

function Convert-One {
  param([string]$Src)

  $Src = ConvertTo-FullPath $Src
  if (-not (Test-Path -LiteralPath $Src -PathType Leaf)) {
    throw "Quelle nicht gefunden: $Src"
  }
  if ([IO.Path]::GetExtension($Src) -notin @('.md', '.markdown')) {
    throw "Keine Markdown-Datei: $Src"
  }
  # Exportiert wird nur mit dem Manifest des Wrappers (spiegelt build.sh): nur er weiss, welche
  # Dateien die Notiz sichtbar einbindet. Hilfe, Version, Aufruffehler und eine fehlende Quelle
  # sind oben schon beantwortet (dort setzt der Wrapper kein Manifest).
  if (-not $env:MDO_MANIFEST -or -not (Test-Path -LiteralPath $env:MDO_MANIFEST -PathType Leaf)) {
    throw "kein Export-Manifest (MDO_MANIFEST) - bitte ueber markdown-office exportieren: markdown-office $Src"
  }

  $srcDir = Split-Path -Parent $Src
  # Basisordner fuer relative Bild- und Logopfade: MDO_BASE_DIR, falls gesetzt
  # (Editoren uebergeben bei ungespeicherten Aenderungen eine temporaere Kopie der
  # Notiz, die Bilder liegen aber neben dem Original), sonst der Ordner der Quelle.
  $baseDir = $srcDir
  if ($env:MDO_BASE_DIR) {
    $b = ConvertTo-FullPath $env:MDO_BASE_DIR
    if (Test-Path -LiteralPath $b -PathType Container) { $baseDir = $b }
    else { Write-Warning "MDO_BASE_DIR ist kein Ordner: $($env:MDO_BASE_DIR) - nutze den Ordner der Quelle." }
  }
  $base   = [IO.Path]::GetFileNameWithoutExtension($Src)
  # UTF-8 explizit lesen: Windows PowerShell 5.1 liest Get-Content sonst in der
  # ANSI-Codepage (CP1252) und verstuemmelt UTF-8-Umlaute (ae/oe/ue/ss -> Mojibake).
  # ReadAllLines mit UTF8Encoding erkennt/entfernt ein evtl. BOM automatisch und
  # passt so zum BOM-losen UTF-8-Schreiben des Render-Temps (siehe WriteAllText).
  # Nur fuer das Frontmatter; die Markdown-Vorverarbeitung macht das Template
  # (lib/markdown.typ) und liest die Quelle selbst.
  $lines  = [IO.File]::ReadAllLines($Src, (New-Object Text.UTF8Encoding $false))

  # Optionalen YAML-Frontmatter (fuehrender ---...---) parsen. Bool-Schluessel
  # werden YAML-1.1-konform gelesen (siehe ConvertTo-YamlBool); ein erkannter
  # Schluessel mit ungueltigem Wert warnt und behaelt den Default. Leere Werte
  # werden ignoriert, nie ein Fehler.
  $fmDate = ''; $fmIsodatePraefix = ''; $fmToc = 'auto'; $fmBreak = 'auto'; $fmShowname = 'true'; $fmLang = 'de'
  $fmHeader = ''; $fmWatermark = ''; $fmTitle = ''
  $fmTemplate = ''; $fmSubtitle = ''; $fmToptitle = ''; $fmAuthor = ''; $fmLogo = ''; $fmLogoHeight = ''; $fmProfile = ''; $fmEmbed = 'true'; $fmBreaks = 'true'
  if ($lines.Count -gt 0 -and $lines[0].Trim() -eq '---') {
    for ($i = 1; $i -lt $lines.Count; $i++) {
      if ($lines[$i].Trim() -in @('---', '...')) { break }
      $line = $lines[$i]
      if ($line -notmatch '^([A-Za-z_-]+):(.*)$') { continue }
      $key = $Matches[1]; $raw = $Matches[2]
      switch ($key) {
        'date'            { $fmDate = ConvertTo-YamlStr $raw }
        'title'           { $fmTitle = ConvertTo-YamlStr $raw }
        'template'        { $fmTemplate = ConvertTo-YamlStr $raw }
        'subtitle'        { $fmSubtitle = ConvertTo-YamlStr $raw }
        'toptitle'        { $fmToptitle = ConvertTo-YamlStr $raw }
        'author'          { $fmAuthor = ConvertTo-YamlStr $raw }
        'logo'            { $fmLogo = ConvertTo-YamlStr $raw }
        'logo-height'     { $fmLogoHeight = ConvertTo-YamlStr $raw }
        'profile'         { $fmProfile = ConvertTo-YamlStr $raw }
        'header'          { $fmHeader = ConvertTo-YamlStr $raw }
        'watermark'       { $fmWatermark = ConvertTo-YamlStr $raw }
        'lang'            { $v = ConvertTo-YamlStr $raw; if ($v) { $fmLang = $v } }
        'isodate_praefix' { $b = Get-FmBool $key $raw; if ($b) { $fmIsodatePraefix = $b } }
        'toc'             { $b = Get-FmBool $key $raw -AllowAuto; if ($b) { $fmToc = $b } }
        'h1_break'        { $b = Get-FmBool $key $raw -AllowAuto; if ($b) { $fmBreak = $b } }
        'print_filename'  { $b = Get-FmBool $key $raw; if ($b) { $fmShowname = $b } }
        'hard_breaks'     { $b = Get-FmBool $key $raw; if ($b) { $fmBreaks = $b } }
        'embed_source'    { $b = Get-FmBool $key $raw; if ($b) { $fmEmbed = $b } }
      }
    }
  }

  if ($NoSource) { $fmEmbed = 'false' }
  if ($HardBreaks) { $fmBreaks = 'true' }
  if ($SoftBreaks) { $fmBreaks = 'false' }

  # Ausgabe: ausdruecklicher Pfad gewinnt (exakt, ohne Praefix). Sonst neben der
  # Quelle; bei erkennbarem Datum ISO-Praefix (sortierbar), ausser
  # 'isodate_praefix: false' (Datum bleibt in der Fusszeile).
  $dateIso = ConvertTo-IsoDate $fmDate
  if ($ExplicitOut) {
    $outPdf = $ExplicitOut
  } else {
    $outName = if ($dateIso -and $fmIsodatePraefix -ne 'false') { "$($dateIso)_$base.pdf" } else { "$base.pdf" }
    $outPdf  = Join-Path $srcDir $outName
  }
  $outName = Split-Path -Leaf $outPdf

  # Vorlage aufloesen. Nur ein ueber den Set-Namen gefundenes Set ist ein Set-Ordner (ganz
  # geprueft und kopiert); eine .typ-Datei ist immer nur diese eine Datei, auch in der Form
  # .\x\x.typ (spiegelt build.sh).
  $templateValue = if ($CliTemplate) { $CliTemplate } else { $fmTemplate }
  $templateSrc = if ($CliTemplate) { Resolve-Template $CliTemplate (Get-Location).Path } else { Resolve-Template $fmTemplate $baseDir -FromNote }
  $byName = (-not $templateValue) -or ($templateValue -cmatch '^[a-z0-9_-]+$')
  if (-not $byName -and -not $CliTemplate -and -not (Test-NoteTemplate $templateSrc @($srcDir, $baseDir, $UserTemplates))) {
    throw "Vorlage muss eine .typ-Datei im Ordner der Notiz oder im Vorlagen-Ordner sein: $fmTemplate"
  }
  $tplDir = Split-Path -Parent $templateSrc
  $tplLeaf = Split-Path -Leaf $templateSrc
  # Set-Ordner nach dem Suchort, der traf (Vorlagen\<name>\<name>.typ oder Sets\<name>\<name>.typ),
  # nicht nach dem Ordnernamen: ein Vorlagen-Ordner, der zufaellig wie das Set heisst (...\meinset
  # mit meinset.typ), ist kein Set-Ordner und bekommt den Filter einer einzelnen .typ.
  $setName = if ($templateValue) { $templateValue } else { 'memo' }
  $setCands = @((Join-Path (Join-Path $SetsDir $setName) "$setName.typ"))
  if ($UserTemplates) { $setCands += (Join-Path (Join-Path $UserTemplates $setName) "$setName.typ") }
  $isSet = $byName -and ($setCands -contains $templateSrc)
  # Offline-Paketablage (spiegelt build.sh): @preview-Pakete aus vendor\packages im
  # Cache-Layout preview\<name>\<version>, nie aus dem Netz; --package-path auf einen Ordner,
  # der nicht mitgeliefert wird (keine @local-Pakete des Rechners). Die Pfade liegen nicht unter
  # --root (Pakete haben eine eigene Wurzel).
  $pkgArgs = @('--package-cache-path', (Join-Path $PipelineRoot 'vendor\packages'),
               '--package-path', (Join-Path $PipelineRoot 'vendor\local-packages'))
  # Kein Netz, nie (1/2, spiegelt build.sh): jeder @preview-Import, der nicht in der Ablage
  # liegt, liesse Typst einen Download in die Ablage versuchen. Abbruch mit Meldung (Exit 1),
  # bevor Typst laeuft. Fail closed: JEDES Vorkommen von @preview/ bis zum Anfuehrungszeichen
  # oder Leerraum zaehlt, auch in Kommentaren, und alles, was kein vorhandener Ablage-Ordner
  # <name>\<version> ist (auch ungueltige Angaben mit Grossbuchstaben oder _), wird
  # abgewiesen. Geprueft wird die Vorlage; ist sie ein Set-Ordner <name>\<name>.typ, jede .typ
  # darin (auch Unterordner), weil ein Set Hilfsdateien einbinden kann. Bei einer einzelnen
  # .typ nur diese, weil ihre Nachbarn andere Sets sein koennen (bindet sie eine Nachbardatei
  # ein, die nach einem fremden Paket greift, stoppt das der Proxy).
  # @(...) um das if: eine Zuweisung aus einer Anweisung entpackt ein einelementiges Array zu
  # einem Skalar (Strict Mode kennt dort kein .Count).
  $scan = @(if ($isSet) {
    Get-ChildItem -LiteralPath $tplDir -Recurse -File -Force -Filter '*.typ' | ForEach-Object { $_.FullName }
  } else { $templateSrc })
  foreach ($f in $scan) {
    foreach ($m in [regex]::Matches([IO.File]::ReadAllText($f), '@preview/[^"\s]*')) {
      $spec = $m.Value.Substring('@preview/'.Length)
      $ok = $spec -cmatch '^([a-z0-9-]+):([0-9]+\.[0-9]+\.[0-9]+)$'
      if ($ok) {
        $dir = Join-Path $PipelineRoot ('vendor\packages\preview\' + $Matches[1] + '\' + $Matches[2])
        $ok = Test-Path -LiteralPath $dir -PathType Container
      }
      if (-not $ok) { throw "Paket nicht mitgeliefert: @preview/$spec (Vorlage $templateSrc)" }
    }
  }

  # Exportiert wird nur mit dem Manifest des Wrappers: nur er weiss (aus dem Markdown-Parser des
  # Editors, nicht aus Typst), welche Dateien die Notiz sichtbar einbindet.
  $manifest = Read-ExportManifest $env:MDO_MANIFEST
  # Das Manifest gilt nur fuer die Notiz, fuer die der Wrapper es schrieb (spiegelt build.sh;
  # verglichen als echte Pfade, Links aufgeloest, ohne Gross-/Kleinschreibung). Warum: mit dem
  # Manifest einer anderen Notiz laegen deren Bilder und Profil im Staging-Ordner, lesbar fuer
  # diese Notiz. Fail closed: fehlt die Angabe oder ist ein Pfad nicht aufloesbar, kein Export.
  $srcReal = Resolve-RealPath $Src
  $noteReal = if ($manifest.Note) { Resolve-RealPath $manifest.Note } else { $null }
  if (-not $srcReal -or -not $noteReal -or
      -not [string]::Equals($srcReal, $noteReal, [StringComparison]::OrdinalIgnoreCase)) {
    $named = if ($manifest.Note) { $manifest.Note } else { 'ohne Angabe' }
    throw "Export-Manifest gehoert zu einer anderen Notiz ($named) - bitte ueber markdown-office exportieren: markdown-office $Src"
  }

  # Staging-Ordner (siehe Kopfkommentar und New-StageDir). Aufbau (Pfade in Typst ab der Wurzel):
  #   /note/<name>.md   die Notiz (Quelle und PDF/A-3-Anhang; der Name bleibt der Anhangsname)
  #   /img/<n>.<endung> die Bilder aus dem Manifest (n: kollisionsfrei, die Endung bleibt)
  #   /logo/<name>      das Logo
  #   /profile/<name>   das Profil und die Bilder daneben, die es nennt (das Set liest sie dort)
  #   /set/...          das Set: Set-Ordner ohne .git und profiles\; bei einer einzelnen, ueber
  #                     den Namen gefundenen .typ ihr Ordner (gefiltert, siehe Copy-StageFolder);
  #                     bei einer .typ-Datei als Pfad nur diese
  #   /mdo/lib, /mdo/vendor/{cmarker,mitex,mmdr}   Pipeline-Bausteine (sys.inputs.mdo = /mdo)
  #   /images.json      Zuordnung Bildquelle -> Pfad im Staging-Ordner
  # Dateien werden als Inhalt kopiert (ein Symlink auf eine Datei wird aufgeloest, das Manifest
  # hat sein Ziel geprueft). Entfernt im finally, bei Erfolg wie bei jedem Fehler.
  $stage = New-StageDir
  try {
    foreach ($sub in @('note', 'img', 'logo', 'profile', 'set', 'mdo', 'mdo\vendor')) {
      [void][IO.Directory]::CreateDirectory((Join-Path $stage $sub))
    }
    # Scheitert eine Kopie von Notiz, Set, Bausteinen oder Profil, bricht der Export ab.
    $copyOrFail = {
      param([string]$From, [string]$To)
      try { [IO.File]::Copy($From, $To, $true) } catch { throw "nicht in den Staging-Ordner kopierbar: $From" }
    }

    # Die Notiz selbst (ihr Dateiname bleibt: Anhangsname im PDF).
    $noteName = [IO.Path]::GetFileName($Src)
    & $copyOrFail $Src (Join-Path $stage "note\$noteName")
    $stagedNote = "/note/$noteName"
    $attach = if ($fmEmbed -ne 'false') { $stagedNote } else { '' }

    # Das Set. Ein Set-Ordner ohne .git (ein geklontes Set-Repo braucht seine Historie nicht im
    # PDF-Lauf) und ohne profiles\: ein Set im Vorlagen-Ordner (Vorlagen\<set>\) haelt dort die
    # Profile aller Absender, und jede Notiz koennte sie lesen. Profile kommen nur ueber das
    # Manifest nach /profile/.
    $stageSet = Join-Path $stage 'set'
    if ($isSet) {
      try {
        foreach ($e in @(Get-ChildItem -LiteralPath $tplDir -Force -ErrorAction Stop)) {
          if ($e.Name -in @('.git', 'profiles')) { continue }
          Copy-Trusted $e.FullName (Join-Path $stageSet $e.Name)
        }
      } catch { throw "nicht in den Staging-Ordner kopierbar: $tplDir ($($_.Exception.Message))" }
    } elseif ($byName) {
      $realTplDir = Resolve-RealPath $tplDir
      if (-not $realTplDir) { throw "nicht in den Staging-Ordner kopierbar: $tplDir" }
      try { Copy-StageFolder $tplDir $stageSet $realTplDir } catch { throw "nicht in den Staging-Ordner kopierbar: $tplDir ($($_.Exception.Message))" }
      # Die Vorlage selbst immer als Inhalt: sie ist die Datei des Nutzers, auch als Symlink aus
      # dem Vorlagen-Ordner heraus (z. B. auf ein eigenes Repo), den Copy-StageFolder auslaesst.
      & $copyOrFail $templateSrc (Join-Path $stageSet $tplLeaf)
    } else {
      # Eine von der Notiz genannte .typ ist oben geprueft (kein Link); --template ist die
      # Datei des Nutzers.
      & $copyOrFail $templateSrc (Join-Path $stageSet $tplLeaf)
    }
    $stagedTemplate = Join-Path $stageSet $tplLeaf

    # Pipeline-Bausteine: lib\ und die Teile von vendor\, die Typst selbst liest (Pakete und
    # Fonts bleiben ausserhalb).
    try {
      Copy-Trusted (Join-Path $PipelineRoot 'lib') (Join-Path $stage 'mdo\lib')
      foreach ($part in @('cmarker', 'mitex', 'mmdr')) {
        $from = Join-Path $PipelineRoot "vendor\$part"
        if (Test-Path -LiteralPath $from -PathType Container) { Copy-Trusted $from (Join-Path $stage "mdo\vendor\$part") }
      }
    } catch { throw "nicht in den Staging-Ordner kopierbar: $PipelineRoot\lib, vendor ($($_.Exception.Message))" }

    # Bilder aus dem Manifest: /img/<n><.endung> (kurz, damit der Pfad unter MAX_PATH bleibt, das
    # .NET Framework ohne Langpfade sonst ablehnt; die Endung wie in der Quelle). Verschwindet eine Datei seit dem Manifest, fehlt
    # nur dieses Bild (Platzhalter im PDF), wie ein nicht gefundenes. Die Zuordnung ist exakt
    # (gross/klein wie in der Notiz), wie json().at() in Typst.
    $imageMap = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
    for ($n = 0; $n -lt $manifest.Refs.Count -and $n -lt $manifest.Paths.Count; $n++) {
      $dest = '/img/' + ($n + 1) + [IO.Path]::GetExtension($manifest.Paths[$n])
      try {
        [IO.File]::Copy($manifest.Paths[$n], (Join-Path $stage ($dest.Substring(1) -replace '/', '\')), $true)
        $imageMap[$manifest.Refs[$n]] = $dest
      } catch {
        Write-Verbose "Bild nicht kopierbar: $($manifest.Paths[$n])"
      }
    }

    # Logo (logo: im Frontmatter; gesucht hat der Wrapper: Ordner der Notiz bzw. MDO_BASE_DIR,
    # Benutzerordner, Vorlagen-Ordner, Pipeline-Ordner). Ohne Logo nur ein Hinweis, nie ein Fehler.
    $logoIn = ''
    if ($manifest.Logo) {
      $logoName = [IO.Path]::GetFileName($manifest.Logo)
      try {
        [IO.File]::Copy($manifest.Logo, (Join-Path $stage "logo\$logoName"), $true)
        $logoIn = "/logo/$logoName"
      } catch { $logoIn = '' }
    }
    if ($fmLogo -and -not $logoIn) {
      if ($fmLogo -match '^(https?:)?//|^data:') {
        Write-Host "Hinweis: Remote-Logo wird nicht geladen (kein Netzzugriff): $fmLogo" -ForegroundColor Yellow
      } elseif ($fmLogo -notmatch '\.(svg|png|jpe?g)$') {
        Write-Host "Hinweis: Logo muss .svg, .png, .jpg oder .jpeg sein: $fmLogo - baue ohne Logo." -ForegroundColor Yellow
      } else {
        Write-Host "Hinweis: Logo nicht gefunden: $fmLogo - baue ohne Logo." -ForegroundColor Yellow
      }
    }

    # Absender-Profil (profile:): gesucht und geprueft hat der Wrapper (profiles\ neben der
    # Notiz, Vorlagen\<set>\profiles, Vorlagen\profiles, Ordner des Sets; ein Pfad nur unter
    # Notiz- oder Vorlagen-Ordner) und bei einem Fehler schon abgebrochen. Das Set liest die
    # YAML-Datei und Dateien daneben (z. B. die Unterschrift): beide liegen in /profile/. Fehlt
    # das Profil trotz profile: im Frontmatter, Exit 1: ein Brief ohne Absender waere schlimmer
    # als keiner.
    $profileIn = ''
    if ($manifest.Profile) {
      $yamlName = [IO.Path]::GetFileName($manifest.Profile)
      & $copyOrFail $manifest.Profile (Join-Path $stage "profile\$yamlName")
      $profileIn = "/profile/$yamlName"
      foreach ($f in $manifest.ProfileFiles) {
        # Nur schlichte Namen neben der YAML-Datei: nie ".", ".." oder ihr eigener Name.
        $fName = [IO.Path]::GetFileName($f)
        if (-not $fName -or $fName -in @('.', '..', $yamlName)) { throw "ungueltige Datei neben dem Profil: $f" }
        & $copyOrFail $f (Join-Path $stage "profile\$fName")
      }
    } elseif ($fmProfile) {
      throw "Profil nicht gefunden: $fmProfile"
    }

    # Laufzeit-Eingaben fuers Template. --root <Staging-Ordner>: Typst behandelt absolute Pfade
    # wurzelrelativ (mit '/') und sperrt Lesezugriffe ausserhalb; alle Pfade zeigen daher in den
    # Staging-Ordner. title = Rueckfall-Metadatentitel (Basisname); doctitle = Frontmatter title:.
    $inputs = @(
      '--input', "filename=$outName",
      '--input', "title=$base",
      '--input', "doctitle=$fmTitle",
      '--input', "subtitle=$fmSubtitle",
      '--input', "toptitle=$fmToptitle",
      '--input', "author=$fmAuthor",
      '--input', "logo=$logoIn",
      '--input', "logo_height=$fmLogoHeight",
      '--input', "profile=$profileIn",
      '--input', "source=$stagedNote",
      '--input', "attach=$attach",
      '--input', 'docdir=/note',
      '--input', "date=$fmDate",
      '--input', "toc=$fmToc",
      '--input', "h1_break=$fmBreak",
      '--input', "showname=$fmShowname",
      '--input', "lang=$fmLang",
      '--input', "header=$fmHeader",
      '--input', "watermark=$fmWatermark",
      '--input', "hard_breaks=$fmBreaks",
      '--input', 'mdo=/mdo',
      '--input', "version=$MdoVersion"
    )
    # Seitenumbruch als Element mdo-pagebreak nur fuer Sets, die das Element kennen (raw-typst
    # aus); alle anderen bekommen wie bisher die raw-typst-Form (lib/markdown.typ pagebreaks).
    # Ein Set-Ordner: jede seiner Dateien im Staging-Ordner (die html:-Zuordnung kann in einer
    # Hilfsdatei stehen). Eine einzelne .typ: nur sie - ihr mitkopierter Ordner enthaelt oft
    # andere Sets (din5008a\), die das Element kennen, und dann verschwaenden die Seitenumbrueche
    # dieser Vorlage still.
    $breakScan = @(if ($isSet) {
      Get-ChildItem -LiteralPath $stageSet -Recurse -File -Force | ForEach-Object { $_.FullName }
    } else { $stagedTemplate })
    if ($breakScan.Count -gt 0 -and (Select-String -LiteralPath $breakScan -Pattern 'mdo-pagebreak' -SimpleMatch -Quiet)) {
      $inputs += @('--input', 'pagebreak=html')
    }

    # Reproduzierbarer Metadaten-Zeitstempel: ohne Frontmatter-date: nutzt das Template
    # date: auto -> Typst schriebe sonst den Build-Zeitpunkt in CreateDate/ModifyDate.
    # SOURCE_DATE_EPOCH (Quell-mtime) macht das deterministisch = letzte Aenderungszeit
    # der Quelle statt "jetzt"; Typst respektiert die Variable fuer date: auto. Ist ein
    # date: gesetzt, pinnt das Template direkt. Ein vom Aufrufer gesetzter Wert gewinnt.
    if (-not $env:SOURCE_DATE_EPOCH) {
      $mtimeUtc = (Get-Item -LiteralPath $Src).LastWriteTimeUtc
      $env:SOURCE_DATE_EPOCH = [string]([DateTimeOffset]$mtimeUtc).ToUnixTimeSeconds()
    }

    # Bilder (Probe-Durchlauf, spiegelt build.sh). Typst kann nicht pruefen, ob eine Datei
    # existiert - ein fehlendes Bild braeche den Build ab. Daher fragt `typst eval` das Template
    # im Probe-Modus (laedt keine Bilder) nach allen Bildquellen (+ Zahl der Remote-Bilder). Die
    # Probe laeuft auf Notiztext und kann beliebige Quellen nennen; sie entscheidet daher NICHT,
    # was ins PDF kommt: die Zuordnung bildet jede Bildquelle des Manifests auf ihre Kopie im
    # Staging-Ordner ab, jede andere Quelle der Probe auf '' (fehlt, "[Bild fehlt: pfad]").
    # Der Ausdruck enthaelt bewusst KEINE doppelten Anfuehrungszeichen: Windows PowerShell 5.1
    # reicht sie an externe Programme nicht korrekt weiter. Meldungen der Probe (z. B. ein
    # Fehler im Notiztext, den gleich das Kompilieren meldet) werden verworfen; ErrorAction
    # Continue, weil umgeleitetes stderr eines Programms in Windows PowerShell 5.1 sonst unter
    # 'Stop' den Export abbraeche.
    $probeExpr = '(str(query(<mdo-remote-skip>).len()),) + query(<mdo-image>).map(m => m.value).dedup()'
    $noNet = $null
    $savedEap = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $noNet = Enable-NoNetwork
      $probeJson = & $TypstExe eval --in $stagedTemplate $probeExpr `
        --font-path $FontDir --ignore-system-fonts @pkgArgs --root $stage @inputs --input probe=true 2>$null
    }
    finally {
      Restore-Network $noNet
      $ErrorActionPreference = $savedEap
    }
    $probe = @()
    try { $probe = @((($probeJson -join "`n") | ConvertFrom-Json) | ForEach-Object { $_ }) } catch { $probe = @() }
    $stripped = 0
    if ($probe.Count -gt 0) {
      [void][int]::TryParse([string]$probe[0], [ref]$stripped)
      foreach ($raw in @($probe | Select-Object -Skip 1)) {
        $ref = [string]$raw
        if (-not $ref -or $imageMap.ContainsKey($ref)) { continue }
        Write-Warning "Bild nicht gefunden: $ref"
        $imageMap[$ref] = ''
      }
    }
    $entries = @(foreach ($k in $imageMap.Keys) { (ConvertTo-JsonString $k) + ':' + (ConvertTo-JsonString $imageMap[$k]) })
    [IO.File]::WriteAllText((Join-Path $stage 'images.json'), ('{' + ($entries -join ',') + '}'),
      (New-Object Text.UTF8Encoding $false))
    $inputs += @('--input', 'images=/images.json')

    # Markdown -> PDF/A-3b. Die Meldungen von Typst gehen unveraendert auf stderr (zeilenweise
    # weitergereicht, um sie fuer den Hinweis unten zu lesen). Ein Hinweis folgt nur, wenn eine
    # als Pfad genannte .typ (allein kopiert) eine Nachbardatei einbindet, die im Originalordner
    # liegt - nie fuer die Vorlage selbst und nie fuer absichtlich ausgelassene Eintraege
    # (profiles\, Punkt-Eintraege).
    $typstErr = New-Object 'System.Collections.Generic.List[string]'
    $compileRc = 0
    $noNet = $null
    try {
      $ErrorActionPreference = 'Continue'
      $noNet = Enable-NoNetwork
      & $TypstExe compile $stagedTemplate $outPdf `
        --font-path $FontDir --ignore-system-fonts `
        @pkgArgs `
        --root $stage `
        --pdf-standard a-3b `
        @inputs 2>&1 | ForEach-Object {
          if ($_ -is [Management.Automation.ErrorRecord]) {
            # Die Zeile steht in TargetObject; eine leere stderr-Zeile hat keins, und ihre Meldung
            # waere nur der Typname (System.Management.Automation.RemoteException).
            if ($_.TargetObject -is [string]) { $line = [string]$_.TargetObject }
            elseif ($_.Exception.Message -eq $_.Exception.GetType().FullName) { $line = '' }
            else { $line = $_.Exception.Message }
            $typstErr.Add($line)
            [Console]::Error.WriteLine($line)
          } else {
            [Console]::Out.WriteLine([string]$_)
          }
        }
      $compileRc = $LASTEXITCODE
    }
    finally {
      Restore-Network $noNet
      $ErrorActionPreference = $savedEap
    }
    if ($compileRc) {
      if (-not $byName) {
        $missing = ''
        foreach ($line in $typstErr) {
          if ($line -match 'file not found \(searched at .*[\\/]mdo-stage-[^\\/]*[\\/]set[\\/](.+)\)\s*$') { $missing = $Matches[1]; break }
        }
        $inOriginal = $false
        if ($missing -and $missing -ne $tplLeaf -and -not (Test-DotSegment $missing) -and -not (Test-ProfilesSegment $missing)) {
          try { $inOriginal = Test-Path -LiteralPath (Join-Path $tplDir $missing) } catch { $inOriginal = $false }
        }
        if ($inOriginal) {
          [Console]::Error.WriteLine('Hinweis: Vorlagen mit mehreren Dateien brauchen einen Set-Ordner <name>\<name>.typ.')
        }
      }
      throw "typst-Fehler ($compileRc)"
    }
  }
  finally {
    Remove-StageDir $stage
  }

  Write-Host "OK  $outPdf" -ForegroundColor Green
  if ($stripped -gt 0) {
    Write-Host "Hinweis: $stripped Remote-Bild(er) uebersprungen (kein Netzzugriff in Typst)." -ForegroundColor Yellow
  }

  # Erzeugte PDF automatisch oeffnen (immer). Opt-out ueber MDO_NO_OPEN=1.
  if (-not $env:MDO_NO_OPEN) { Start-Process -FilePath $outPdf }
}

try {
  if (-not (Get-Command $TypstExe -ErrorAction SilentlyContinue)) {
    throw "typst nicht gefunden ($TypstExe); erwartet in $PipelineRoot\bin\typst.exe oder im PATH"
  }
  foreach ($p in $Path) { Convert-One $p }
}
catch {
  # Fehler auf stderr (aufrufende Programme zeigen ihn an), dann sofort Exit 1.
  # Der Staging-Ordner ist hier schon entfernt (finally in Convert-One).
  [Console]::Error.WriteLine("Fehler: $($_.Exception.Message)")
  # Mit MDO_DEBUG (CI) die Stelle im Skript dazu, damit ein unerwarteter Fehler zuzuordnen ist;
  # sonst nicht: die App zeigt stderr unter jedem gescheiterten Export.
  if ($env:MDO_DEBUG -and $_.InvocationInfo -and $_.InvocationInfo.PositionMessage) {
    [Console]::Error.WriteLine($_.InvocationInfo.PositionMessage)
  }
  exit 1
}
