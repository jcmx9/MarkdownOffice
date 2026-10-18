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
# Typst-Root im Normalfall: das Laufwerks-Wurzelverzeichnis des Pipeline-Ordners.
# Damit sind lib/, vendor/ und die Sets direkt lesbar; Dateien auf anderen
# Laufwerken werden bereitgestellt (siehe Initialize-Stage).
$Root        = [IO.Path]::GetPathRoot($PipelineRoot)

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
  title, subtitle, client, author, date, isodate_praefix, toc, h1_break,
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

# Einen Windows-Pfad in einen Typst-tauglichen Pfad wandeln. Typst loest die
# --input-Pfade (read/image/pdf.attach/docdir) INTERN ueber sein virtuelles
# Dateisystem RELATIV zu --root auf. Zwei Regeln gelten dort:
#   1. keine Backslashes            -> '\' zu '/'
#   2. kein Laufwerksbuchstabe      -> fuehrendes 'C:' entfernen, sodass der
#      ("path contains invalid          Pfad wurzel-relativ mit '/' beginnt
#       component `C:`")                 ('C:\Users\x' -> '/Users/x')
# Das spiegelt build.sh (macOS/Linux: --root / + '/'-absolute Pfade). --root ist
# ein Laufwerks-Wurzelverzeichnis ($script:TypstRoot), daher werden nur Pfade auf
# diesem Laufwerk gewandelt; alles andere ist vorher bereitgestellt (siehe
# Initialize-Stage). Reine CLI-fs-Argumente (Template, Ausgabe, --root,
# --font-path) sind NICHT betroffen.
function ConvertTo-TypstPath {
  param([string]$Path)
  if (-not $Path) { return '' }
  return ($Path -replace '\\', '/') -replace '^[A-Za-z]:', ''
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

# Typst liest nur unterhalb EINES --root, und ein --root umfasst unter Windows
# nie mehr als ein Laufwerk. Normalfall: --root = Laufwerk des Pipeline-Ordners
# (lib\, vendor\ und die Sets liegen dort). Eine Notiz, ein Bild, ein Logo oder
# eine Vorlage auf einem anderen Laufwerk (Notiz auf D:, Markdown Office unter
# C:\Users\...\AppData) wird fuer den Build in einen temporaeren Ordner auf dem
# Laufwerk von --root kopiert ("Bereitstellung"); dort liegt auch die
# Bild-Zuordnung (JSON, von Typst gelesen). Der Ordner wird danach entfernt.
#
# Initialize-Stage legt den Bereitstellungsordner zu Beginn jedes Builds an
# (die Bild-Zuordnung braucht ihn immer) und legt damit --root fest:
#   1. Ein beschreibbarer Ordner auf dem Laufwerk des Pipeline-Ordners: zuerst
#      %TEMP%, dann %LOCALAPPDATA%, dann das Arbeitsverzeichnis, dann die Ordner
#      von Quelle und Ausgabe. --root bleibt dieses Laufwerk.
#   2. Gibt es dort keinen (App z. B. auf D:, %TEMP%, Notiz und Ausgabe auf C:),
#      wechselt --root auf das Laufwerk des ersten beschreibbaren Ordners derselben
#      Liste. Die Teile der Pipeline, die Typst selbst liest (lib\ und vendor\,
#      wenige MB), werden dann mit bereitgestellt und sys.inputs.mdo zeigt dorthin;
#      Vorlage und Pipeline-Logo folgen wie jede Datei auf einem fremden Laufwerk.
#      Die Schriften bleiben, wo sie sind (--font-path ist ein normaler Pfad und
#      liegt nicht unter --root).
# Nie im Pipeline-Ordner selbst (in der App ggf. schreibgeschuetzt) und nie
# neben der Installation: ein fester Ordner dort ist weder sicher vorhanden
# noch sicher beschreibbar.
$script:StageDir = ''
$script:StageCount = 0
$script:TypstRoot = $Root
$script:TypstMdo = $PipelineRoot

# Liegt $P im Pipeline-Ordner (oder ist es dieser)?
function Test-InPipeline {
  param([string]$P)
  $full = [IO.Path]::GetFullPath($P).TrimEnd('\', '/')
  return ($full.Equals($PipelineRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $full.StartsWith($PipelineRoot + '\', [StringComparison]::OrdinalIgnoreCase))
}

# Einen leeren Bereitstellungsordner in $Dir anlegen; '' wenn das nicht geht.
function New-StageIn {
  param([string]$Dir)
  $d = Join-Path $Dir ('mdo-stage-' + [Guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Force -Path $d -ErrorAction Stop | Out-Null
    return $d
  } catch { return '' }
}

function Initialize-Stage {
  param([string]$Src, [string]$OutPdf)
  $script:StageDir = ''; $script:StageCount = 0
  $script:TypstRoot = $Root; $script:TypstMdo = $PipelineRoot
  $cands = @(@([IO.Path]::GetTempPath(), $env:LOCALAPPDATA, (Get-Location).Path,
      (Split-Path -Parent $Src), (Split-Path -Parent $OutPdf)) |
    Where-Object { $_ -and -not (Test-InPipeline $_) })
  # 1. Auf dem Laufwerk des Pipeline-Ordners: nichts muss umziehen.
  foreach ($c in $cands) {
    if ([IO.Path]::GetPathRoot($c) -ne $Root) { continue }
    $d = New-StageIn $c
    if ($d) { $script:StageDir = $d; return }
  }
  # 2. Sonst: --root auf ein anderes Laufwerk, lib\ und vendor\ mit bereitstellen.
  foreach ($c in $cands) {
    if ([IO.Path]::GetPathRoot($c) -eq $Root) { continue }
    $d = New-StageIn $c
    if (-not $d) { continue }
    $script:StageDir = $d
    $mdo = Join-Path $d 'pipeline'
    New-Item -ItemType Directory -Force -Path $mdo | Out-Null
    foreach ($part in @('lib', 'vendor')) {
      Copy-Item -LiteralPath (Join-Path $PipelineRoot $part) -Destination (Join-Path $mdo $part) -Recurse -Force
    }
    $script:TypstRoot = [IO.Path]::GetPathRoot($d)
    $script:TypstMdo = $mdo
    return
  }
  throw ("Kein beschreibbarer Ordner fuer die Bereitstellung gefunden (gesucht in: " +
    ($cands -join ', ') + ')')
}

function Get-TypstReadable {
  param([string]$Path, [string]$Name = '')
  if (-not $Path) { return $Path }
  if ([IO.Path]::GetPathRoot($Path) -eq $script:TypstRoot) { return $Path }
  if (-not $Name) {
    $script:StageCount++
    $Name = ('datei-' + $script:StageCount + [IO.Path]::GetExtension($Path))
  }
  $target = Join-Path $script:StageDir $Name
  Copy-Item -LiteralPath $Path -Destination $target -Force
  return $target
}

# Ordner fuer Typst lesbar machen (spiegelt Get-TypstReadable fuer einen ganzen Ordner):
# liegt er auf einem anderen Laufwerk als die Typst-Wurzel, wird er komplett in den
# Stage-Ordner kopiert. Das Profil braucht das, weil das Set Dateien daneben liest
# (die Unterschrift).
function Get-TypstReadableDir {
  param([string]$Dir)
  if (-not $Dir) { return $Dir }
  if ([IO.Path]::GetPathRoot($Dir) -eq $script:TypstRoot) { return $Dir }
  $script:StageCount++
  $target = Join-Path $script:StageDir ('ordner-' + $script:StageCount)
  Copy-Item -LiteralPath $Dir -Destination $target -Recurse -Force
  return $target
}

# Vorlage aufloesen (spiegelt resolve_template in build.sh): leer -> memo;
# ein Name (a-z, 0-9, _ und -) ist ein Set (Benutzerordner <name>.typ oder
# <name>\<name>.typ vor den mitgelieferten Sets <MDO_SETS_DIR>\<name>\<name>.typ); ein Wert auf .typ eine
# einzelne Datei relativ zu $Base.
function Resolve-Template {
  param([string]$Value, [string]$Base)
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
  $fmTemplate = ''; $fmSubtitle = ''; $fmClient = ''; $fmAuthor = ''; $fmLogo = ''; $fmLogoHeight = ''; $fmProfile = ''; $fmEmbed = 'true'; $fmBreaks = 'true'
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
        'client'          { $fmClient = ConvertTo-YamlStr $raw }
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

  # Logo nur mit logo: im Frontmatter (ohne Schluessel oder leer: kein Logo).
  # Der Wert ist eine Datei .svg/.png/.jpg/.jpeg. Absolut (auch ueber ~,
  # %USERPROFILE% oder $HOME) -> genau diese Datei; relativ -> zuerst im Ordner
  # der Notiz (bzw. MDO_BASE_DIR), dann im Benutzerordner, dann im Vorlagen-Ordner
  # (MDO_TEMPLATES bzw. Dokumente\Markdown Office\Vorlagen), dann im Pipeline-Ordner.
  # Nichts gefunden -> ohne Logo, nur ein Hinweis, nie ein Fehler.
  $logoArg = ''
  if ($fmLogo) {
    if ($fmLogo -match '^(https?:)?//|^data:') {
      Write-Host "Hinweis: Remote-Logo wird nicht geladen (kein Netzzugriff): $fmLogo" -ForegroundColor Yellow
    } elseif ($fmLogo -notmatch '\.(svg|png|jpe?g)$') {
      Write-Host "Hinweis: Logo muss .svg, .png, .jpg oder .jpeg sein: $fmLogo - baue ohne Logo." -ForegroundColor Yellow
    } else {
      $noteLogo = Expand-NotePath $fmLogo
      if ([IO.Path]::IsPathRooted($noteLogo)) {
        if (Test-Path -LiteralPath $noteLogo -PathType Leaf) { $logoArg = $noteLogo }
      } else {
        foreach ($dir in @($baseDir, (Get-EnvFallback 'USERPROFILE'), $UserTemplates, $PipelineRoot)) {
          if (-not $dir) { continue }
          $cand = [IO.Path]::Combine($dir, $noteLogo)
          if (Test-Path -LiteralPath $cand -PathType Leaf) { $logoArg = $cand; break }
        }
      }
      if (-not $logoArg) {
        Write-Host "Hinweis: Logo nicht gefunden: $fmLogo - baue ohne Logo." -ForegroundColor Yellow
      }
    }
  }

  # Laufzeit-Eingaben fuers Template. title = Rueckfall-Metadatentitel
  # (Basisname); doctitle = Frontmatter title:. --root deckt das Laufwerk ab,
  # damit absolute Pfade (Quelle, Anhang, Bilder) lesbar sind.
  # Pfad-Inputs, die Typst INTERN aufloest (read/image/pdf.attach + docdir),
  # in wurzel-relative Typst-Pfade wandeln (Backslashes -> '/', Laufwerk weg);
  # siehe ConvertTo-TypstPath. Die CLI-fs-Argumente bleiben unveraendert.
  # Quelle und Logo fuer Typst erreichbar machen (anderes Laufwerk als --root ->
  # Kopie im Bereitstellungsordner). Die Kopie der Quelle traegt ihren Dateinamen:
  # so bleibt der Anhang im PDF unter dem Originalnamen und mit dem Originalinhalt.
  Initialize-Stage $Src $outPdf
  # Vorlage aufloesen; eine Vorlage auf einem anderen Laufwerk wird bereitgestellt.
  $templateSrc = if ($CliTemplate) { Resolve-Template $CliTemplate (Get-Location).Path } else { Resolve-Template $fmTemplate $baseDir }
  $templateFile = Get-TypstReadable $templateSrc ([IO.Path]::GetFileName($templateSrc))
  # Absender-Profil (profile:), spiegelt build.sh: Name -> profiles\<name>.yaml im Ordner
  # der Notiz (bzw. MDO_BASE_DIR), im Vorlagen-Ordner, im Ordner des Sets; sonst ein Pfad
  # auf .yaml/.yml. Nicht gefunden -> Exit 1 (kein Brief ohne Absender).
  $profileArg = ''
  if ($fmProfile) {
    if ($fmProfile -cmatch '^[a-z0-9_-]+$') {
      $setDir = Split-Path -Parent $templateSrc
      $dirs = @((Join-Path $baseDir 'profiles'))
      if ($UserTemplates) { $dirs += (Join-Path $UserTemplates 'profiles') }
      $dirs += (Join-Path $setDir 'profiles')
      foreach ($d in $dirs) {
        $cand = Join-Path $d "$fmProfile.yaml"
        if (Test-Path -LiteralPath $cand -PathType Leaf) { $profileArg = $cand; break }
      }
      if (-not $profileArg) { throw "Profil nicht gefunden: $fmProfile (gesucht in $($dirs -join ', '))" }
    } elseif ($fmProfile -match '\.ya?ml$') {
      $pp = Expand-NotePath $fmProfile
      if (-not [IO.Path]::IsPathRooted($pp)) { $pp = [IO.Path]::Combine($baseDir, $pp) }
      $pp = [IO.Path]::GetFullPath($pp)
      if (-not (Test-Path -LiteralPath $pp -PathType Leaf)) { throw "Profil nicht gefunden: $fmProfile" }
      $profileArg = $pp
    } else {
      throw "ungueltiges Profil: $fmProfile (erlaubt: Name aus a-z, 0-9, _ und - oder eine .yaml-Datei)"
    }
  }
  $typstProfile = ''
  if ($profileArg) {
    $readableDir = Get-TypstReadableDir (Split-Path -Parent $profileArg)
    $typstProfile = Join-Path $readableDir (Split-Path -Leaf $profileArg)
  }
  $profileFwd = ConvertTo-TypstPath $typstProfile
  $typstSrc     = Get-TypstReadable $Src ([IO.Path]::GetFileName($Src))
  $typstLogo    = Get-TypstReadable $logoArg
  $typstBase    = if ([IO.Path]::GetPathRoot($baseDir) -eq $script:TypstRoot) { $baseDir } else { Split-Path -Parent $typstSrc }
  $srcFwd       = ConvertTo-TypstPath $typstSrc
  $srcDirTypst  = ConvertTo-TypstPath $typstBase
  $logoFwd      = ConvertTo-TypstPath $typstLogo
  $attachFwd    = if ($fmEmbed -ne 'false') { $srcFwd } else { '' }
  $inputs = @(
    '--input', "filename=$outName",
    '--input', "title=$base",
    '--input', "doctitle=$fmTitle",
    '--input', "subtitle=$fmSubtitle",
    '--input', "client=$fmClient",
    '--input', "author=$fmAuthor",
    '--input', "logo=$logoFwd",
    '--input', "logo_height=$fmLogoHeight",
    '--input', "profile=$profileFwd",
    '--input', "source=$srcFwd",
    '--input', "attach=$attachFwd",
    '--input', "docdir=$srcDirTypst",
    '--input', "date=$fmDate",
    '--input', "toc=$fmToc",
    '--input', "h1_break=$fmBreak",
    '--input', "showname=$fmShowname",
    '--input', "lang=$fmLang",
    '--input', "header=$fmHeader",
    '--input', "watermark=$fmWatermark",
    '--input', "hard_breaks=$fmBreaks",
    '--input', ('mdo=' + (ConvertTo-TypstPath $script:TypstMdo)),
    '--input', "version=$MdoVersion"
  )

  # Reproduzierbarer Metadaten-Zeitstempel: ohne Frontmatter-date: nutzt das Template
  # date: auto -> Typst schriebe sonst den Build-Zeitpunkt in CreateDate/ModifyDate.
  # SOURCE_DATE_EPOCH (Quell-mtime) macht das deterministisch = letzte Aenderungszeit
  # der Quelle statt "jetzt"; Typst respektiert die Variable fuer date: auto. Ist ein
  # date: gesetzt, pinnt das Template direkt. Ein vom Aufrufer gesetzter Wert gewinnt.
  if (-not $env:SOURCE_DATE_EPOCH) {
    $mtimeUtc = (Get-Item -LiteralPath $Src).LastWriteTimeUtc
    $env:SOURCE_DATE_EPOCH = [string]([DateTimeOffset]$mtimeUtc).ToUnixTimeSeconds()
  }

  # Bilder pruefen (Probe-Durchlauf, spiegelt build.sh): Typst kann weder
  # Umgebungsvariablen lesen noch pruefen, ob eine Datei existiert. Das Template
  # meldet im Probe-Modus alle Bildquellen (+ Zahl der Remote-Bilder); hier
  # ~/$VAR/${VAR}/%VAR% ersetzen, relativ zur Notiz aufloesen und pruefen. Ein
  # fehlendes Bild erscheint im PDF als "[Bild fehlt: pfad]". Ein Bild auf einem
  # anderen Laufwerk als --root wird bereitgestellt (siehe Get-TypstReadable).
  # Der Ausdruck enthaelt bewusst KEINE doppelten Anfuehrungszeichen:
  # Windows PowerShell 5.1 reicht sie an externe Programme nicht korrekt weiter.
  $probeExpr = '(str(query(<mdo-remote-skip>).len()),) + query(<mdo-image>).map(m => m.value).dedup()'
  $probeJson = & $TypstExe eval --in $templateFile $probeExpr `
    --font-path $FontDir --ignore-system-fonts --root $script:TypstRoot @inputs --input probe=true 2>$null
  $probe = @()
  try { $probe = @((($probeJson -join "`n") | ConvertFrom-Json) | ForEach-Object { $_ }) } catch { $probe = @() }
  $stripped = 0
  $imageMap = @{}
  if ($probe.Count -gt 0) {
    [void][int]::TryParse([string]$probe[0], [ref]$stripped)
    foreach ($raw in ($probe | Select-Object -Skip 1)) {
      $img = Expand-NotePath ([string]$raw)
      if (-not [IO.Path]::IsPathRooted($img)) { $img = Join-Path $baseDir $img }
      $img = [IO.Path]::GetFullPath($img)
      if (Test-Path -LiteralPath $img -PathType Leaf) {
        # Bild auf einem anderen Laufwerk: fuer Typst bereitstellen
        $imageMap[[string]$raw] = ConvertTo-TypstPath (Get-TypstReadable $img)
      } else {
        Write-Warning "Bild nicht gefunden: $raw"
        $imageMap[[string]$raw] = ''
      }
    }
  }
  # Die Zuordnung liest Typst selbst (json()), also im Bereitstellungsordner auf
  # dem Laufwerk von --root ablegen (siehe Initialize-Stage), nie im Pipeline-Ordner.
  $imagesJson = Join-Path $script:StageDir 'images.json'
  [IO.File]::WriteAllText($imagesJson, ($imageMap | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
  $inputs += @('--input', ('images=' + (ConvertTo-TypstPath $imagesJson)))

  try {
    & $TypstExe compile $templateFile $outPdf `
      --font-path $FontDir --ignore-system-fonts `
      --root $script:TypstRoot `
      --pdf-standard a-3b `
      @inputs
    if ($LASTEXITCODE) { throw "typst-Fehler ($LASTEXITCODE)" }
  }
  finally {
    if ($script:StageDir) { Remove-Item -LiteralPath $script:StageDir -Recurse -Force -ErrorAction SilentlyContinue }
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
  [Console]::Error.WriteLine("Fehler: $($_.Exception.Message)")
  # Bereitstellung auch bei einem Abbruch vor dem Kompilieren entfernen
  if ($script:StageDir) { Remove-Item -LiteralPath $script:StageDir -Recurse -Force -ErrorAction SilentlyContinue }
  exit 1
}
