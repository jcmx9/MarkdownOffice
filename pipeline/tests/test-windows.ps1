#requires -Version 5.1
<#
.SYNOPSIS
  Windows-Rauchtest fuer convert.ps1 (CI).
.DESCRIPTION
  Spielt den Aufruf aus einem anderen Programm nach: absolute Ein- und Ausgabepfade mit
  Leerzeichen, Aufruf aus einem fremden Arbeitsverzeichnis, POSIX-Optionen
  (--no-source, --hard-breaks, --), temporaere Kopie mit MDO_BASE_DIR, Notizen auf
  einem anderen Laufwerk als die Pipeline (auch wie der Editor: Arbeitsordner =
  Notizordner, TEMP auf dem anderen Laufwerk), UTF-8-Ausgabe sowie die Exit-Codes.

  Layout: getestet wird pipeline\convert.ps1 mit MDO_PIPELINE_ROOT und
  MDO_SETS_DIR. Ohne MDO_PIPELINE_ROOT gilt das Entwicklungs-Layout
  build\pipeline-dev\ (entspricht dem gepackten Layout der App). Vorher
  ausfuehren: npm run assets, dann bash pipeline/tests/dev-layout.sh.
  Arbeitsdateien liegen unter build\tmp\ im Repo (bzw. im %TEMP%), eigene
  Vorlagen nur aus MDO_TEMPLATES dort, nie aus "Dokumente".

  Datei muss reines ASCII bleiben (Windows PowerShell 5.1 liest CP1252).
#>
$ErrorActionPreference = 'Continue'
$env:MDO_NO_OPEN = '1'

$Repo     = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Convert  = Join-Path (Split-Path -Parent $PSScriptRoot) 'convert.ps1'
$Fixtures = Join-Path $PSScriptRoot 'fixtures'
if (-not $env:MDO_PIPELINE_ROOT) {
  $env:MDO_PIPELINE_ROOT = Join-Path $Repo 'build\pipeline-dev\pipeline'
  $env:MDO_SETS_DIR = Join-Path $Repo 'build\pipeline-dev\sets'
}
$Root     = $env:MDO_PIPELINE_ROOT
if (-not (Test-Path -LiteralPath (Join-Path $Root 'lib') -PathType Container)) {
  Write-Host "FEHLER: Pipeline-Layout fehlt: $Root (npm run assets; bash pipeline/tests/dev-layout.sh)" -ForegroundColor Red
  exit 1
}
# Arbeitsordner im Repo, auf dem Laufwerk des Pipeline-Ordners (Typst liest nur dort).
$Work     = Join-Path $Repo 'build\tmp\mdo win test'
$failed   = 0
# Leerer Vorlagen-Ordner (mit Leerzeichen) im Temp-Ordner: ein echter Ordner
# "Dokumente\Markdown Office\Vorlagen" des Runners kann das mitgelieferte Set nicht
# ueberschatten. Tests mit eigenem Set setzen MDO_TEMPLATES selbst und stellen zurueck.
$EmptyTemplates = Join-Path ([IO.Path]::GetTempPath()) ('mdo keine vorlagen ' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $EmptyTemplates | Out-Null
$env:MDO_TEMPLATES = $EmptyTemplates

function Fail([string]$msg) { Write-Host "FEHLER: $msg" -ForegroundColor Red; $script:failed++ }
function Skip([string]$msg) { Write-Host "skip $msg" }
function Ok([string]$msg)   { Write-Host "ok   $msg" }

# convert.ps1 so aufrufen wie andere Programme (powershell -File), Ausgabe einsammeln.
function Invoke-Convert {
  param([string[]]$ArgList)
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Convert @ArgList 2>&1 | Out-String
  return @{ Code = $LASTEXITCODE; Text = $out }
}

function Test-PdfA([string]$pdf) {
  if (-not (Test-Path -LiteralPath $pdf -PathType Leaf)) { return $false }
  $raw = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($pdf))
  return $raw.Contains('part>3</pdfaid:part')
}

# Ist der Marker aus dem Titel-Metadatum (XMP, unkomprimiert) im PDF? Beweist, welche Vorlage lief.
function Test-PdfMarker([string]$pdf, [string]$marker) {
  if (-not (Test-Path -LiteralPath $pdf -PathType Leaf)) { return $false }
  $raw = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($pdf))
  return $raw.Contains($marker)
}

if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
$inDir  = Join-Path $Work 'Notiz Ordner'
$outDir = Join-Path $Work 'Aus gabe'
New-Item -ItemType Directory -Force -Path (Join-Path $inDir 'bilder'), $outDir | Out-Null
Copy-Item -LiteralPath (Join-Path $Fixtures 'client-meta.md') -Destination (Join-Path $inDir 'meine notiz.md')
Copy-Item -LiteralPath (Join-Path $Fixtures 'logo.png') -Destination $inDir
Copy-Item -LiteralPath (Join-Path $Fixtures 'edge-cases.md') -Destination (Join-Path $inDir 'mit bild.md')
Copy-Item -LiteralPath (Join-Path $Fixtures 'bilder\screenshot.png') -Destination (Join-Path $inDir 'bilder')
$note = Join-Path $inDir 'meine notiz.md'

# Fremdes Arbeitsverzeichnis (andere Programme starten nicht im Notizordner).
Set-Location ([IO.Path]::GetPathRoot($Root))

# 1) Absolute Pfade mit Leerzeichen + POSIX-Optionen: PDF genau am Zielpfad,
#    kein ISO-Praefix trotz date: im Frontmatter.
$target = Join-Path $outDir 'mein pdf.pdf'
$r = Invoke-Convert @('--no-source', '--hard-breaks', $note, $target)
if ($r.Code -ne 0) { Fail "convert.ps1 mit absoluten Pfaden: Exit $($r.Code)`n$($r.Text)" }
elseif (-not (Test-PdfA $target)) { Fail "PDF fehlt am Zielpfad oder ist kein PDF/A-3: $target`n$($r.Text)" }
elseif (Get-ChildItem -LiteralPath $outDir -Filter '2026-*') { Fail 'ISO-Praefix trotz ausdruecklicher Ausgabe' }
else { Ok 'convert.ps1: absolute Pfade mit Leerzeichen, --no-source, --hard-breaks' }

# 3) Temporaere Kopie + MDO_BASE_DIR: Bilder relativ zum Originalordner.
$copyDir = Join-Path $Work 'temp kopie'
New-Item -ItemType Directory -Force -Path $copyDir | Out-Null
Copy-Item -LiteralPath (Join-Path $inDir 'mit bild.md') -Destination $copyDir
$env:MDO_BASE_DIR = $inDir
$target3 = Join-Path $outDir 'basis.pdf'
$r = Invoke-Convert @((Join-Path $copyDir 'mit bild.md'), $target3)
Remove-Item Env:\MDO_BASE_DIR
if ($r.Code -ne 0) { Fail "MDO_BASE_DIR: Exit $($r.Code)`n$($r.Text)" }
elseif ($r.Text -match 'nicht gefunden') { Fail "MDO_BASE_DIR: Bild nicht gefunden`n$($r.Text)" }
elseif (-not (Test-PdfA $target3)) { Fail 'MDO_BASE_DIR: PDF fehlt' }
else { Ok 'MDO_BASE_DIR (temporaere Kopie)' }

# Ein Temp-Ordner auf einem ANDEREN Laufwerk als der Pipeline-Ordner (Runner:
# Repo auf D:, Benutzer-Temp auf C:): %TEMP% oder, wenn die CI TEMP auf das
# Repo-Laufwerk legt, das Temp des Benutzerprofils (GetFolderPath liest nicht TEMP).
$OtherTemp = ''
foreach ($t in @([IO.Path]::GetTempPath(), (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Temp'))) {
  if ($t -and [IO.Path]::GetPathRoot($t) -ne [IO.Path]::GetPathRoot($Root) -and (Test-Path -LiteralPath $t -PathType Container)) {
    $OtherTemp = $t; break
  }
}

# Eine Notiz mit relativem Bild, Logo und einem Bild per absolutem Pfad auf dem
# Repo-Laufwerk in $Dir anlegen; gibt den Pfad der Notiz zurueck.
function New-DriveNote([string]$Dir) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'bilder') | Out-Null
  Copy-Item -LiteralPath (Join-Path $Fixtures 'bilder\screenshot.png') -Destination (Join-Path $Dir 'bilder')
  Copy-Item -LiteralPath (Join-Path $Fixtures 'logo.png') -Destination $Dir
  $absImg = (Join-Path $Fixtures 'bilder\screenshot.png')
  $noteText = "---`ntitle: `"Andere Platte`"`nlogo: logo.png`n---`n`n# Kapitel`n`n![Relativ](bilder/screenshot.png)`n`n![Absolut auf dem Repo-Laufwerk]($absImg)`n`nText nach den Bildern.`n"
  $n = Join-Path $Dir 'notiz.md'
  [IO.File]::WriteAllText($n, $noteText, (New-Object Text.UTF8Encoding $false))
  return $n
}

# Bereitstellungsordner, die nach einem Build noch in $Dirs liegen.
function Get-StageLeftovers([string[]]$Dirs) {
  return @(foreach ($d in $Dirs) {
    if ($d) { Get-ChildItem -LiteralPath $d -Directory -Filter 'mdo-stage-*' -Force -ErrorAction SilentlyContinue }
  })
}

# 3b) Notiz auf einem ANDEREN Laufwerk als der Pipeline-Ordner, Aufruf aus dem
#     Laufwerks-Wurzelverzeichnis der Pipeline (dort ist ein Bereitstellungsordner
#     moeglich). Ausgabe ebenfalls auf dem anderen Laufwerk. Bereitstellungsordner
#     muss danach weg.
if ($OtherTemp) {
  $otherRoot = [IO.Path]::GetPathRoot($OtherTemp)
  $drvTmp  = Join-Path $OtherTemp ('mdo andere platte ' + [Guid]::NewGuid().ToString('N'))
  $drvDir  = Join-Path $drvTmp 'Notizen mit Leerzeichen'
  $drvOut  = Join-Path $drvTmp 'Export Ziel'
  New-Item -ItemType Directory -Force -Path $drvOut | Out-Null
  $drvNote = New-DriveNote $drvDir
  $drvPdf = Join-Path $drvOut 'notiz.pdf'
  $r = Invoke-Convert @($drvNote, $drvPdf)
  $leftover = Get-StageLeftovers @([IO.Path]::GetTempPath(), $env:LOCALAPPDATA, (Get-Location).Path, $Root, $drvDir, $drvOut)
  if ($r.Code -ne 0) { Fail "anderes Laufwerk: Exit $($r.Code)`n$($r.Text)" }
  elseif (-not (Test-PdfA $drvPdf)) { Fail "anderes Laufwerk: PDF fehlt am Zielpfad`n$($r.Text)" }
  elseif ($r.Text -match 'nicht gefunden') { Fail "anderes Laufwerk: Bild/Logo nicht gefunden`n$($r.Text)" }
  elseif ($leftover.Count -gt 0) { Fail "anderes Laufwerk: Bereitstellungsordner nicht entfernt" }
  else { Ok "Notiz auf anderem Laufwerk ($otherRoot) als die Pipeline ($([IO.Path]::GetPathRoot($Root)))" }

  # 3b2) Wie der Editor: Arbeitsordner = Notizordner, und TEMP, TMP und LOCALAPPDATA
  #      liegen ebenfalls auf dem anderen Laufwerk. Auf dem Laufwerk der Pipeline
  #      ist damit kein Bereitstellungsordner moeglich: --root wechselt auf das
  #      Laufwerk der Notiz, lib\ und vendor\ werden mit bereitgestellt.
  $edDir = Join-Path $drvTmp 'Editor Notizen'
  $edTemp = Join-Path $drvTmp 'Temp Ordner'
  $edLocal = Join-Path $drvTmp 'Local AppData'
  New-Item -ItemType Directory -Force -Path $edTemp, $edLocal | Out-Null
  $edNote = New-DriveNote $edDir
  $edPdf = Join-Path $edDir 'notiz.pdf'
  $saved = @{ TEMP = $env:TEMP; TMP = $env:TMP; LOCALAPPDATA = $env:LOCALAPPDATA }
  $env:TEMP = $edTemp; $env:TMP = $edTemp; $env:LOCALAPPDATA = $edLocal
  Push-Location $edDir
  $r = Invoke-Convert @($edNote)
  Pop-Location
  $env:TEMP = $saved.TEMP; $env:TMP = $saved.TMP; $env:LOCALAPPDATA = $saved.LOCALAPPDATA
  $leftover = Get-StageLeftovers @($edTemp, $edLocal, $edDir, $Root)
  if ($r.Code -ne 0) { Fail "Editor-Fall (anderes Laufwerk, Arbeitsordner = Notizordner): Exit $($r.Code)`n$($r.Text)" }
  elseif (-not (Test-PdfA $edPdf)) { Fail "Editor-Fall: PDF fehlt neben der Notiz`n$($r.Text)" }
  elseif ($r.Text -match 'nicht gefunden') { Fail "Editor-Fall: Bild/Logo nicht gefunden`n$($r.Text)" }
  elseif ($leftover.Count -gt 0) { Fail 'Editor-Fall: Bereitstellungsordner nicht entfernt' }
  else { Ok "Editor-Fall: Notiz, TEMP und Arbeitsordner auf $otherRoot, Pipeline auf $([IO.Path]::GetPathRoot($Root))" }
  Remove-Item -LiteralPath $drvTmp -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Skip 'anderes Laufwerk (kein Temp-Ordner auf einem anderen Laufwerk als das Repo)'
}

# 3b) Logo nur mit logo:; relativ gesucht im Notizordner, dann im Benutzerordner
#     (%USERPROFILE%), dann im Vorlagen-Ordner (MDO_TEMPLATES), dann im
#     Pipeline-Ordner. Nicht gefunden: Hinweis, Exit 0.
$logoDir  = Join-Path $Work 'logo notiz'
$logoHome = Join-Path $Work 'logo home'
$logoVorl = Join-Path $Work 'logo vorlagen'
New-Item -ItemType Directory -Force -Path $logoDir, $logoHome, $logoVorl | Out-Null
Copy-Item -LiteralPath (Join-Path $Fixtures 'logo.png') -Destination (Join-Path $logoHome 'mein-logo.png')
Copy-Item -LiteralPath (Join-Path $Fixtures 'logo.png') -Destination (Join-Path $logoVorl 'vorlagen-logo.png')
$logoPdf = Join-Path $outDir 'logo.pdf'
$savedProfile = $env:USERPROFILE
$savedTemplates = $env:MDO_TEMPLATES
$env:USERPROFILE = $logoHome
$env:MDO_TEMPLATES = $logoVorl
foreach ($case in @(
    @{ Logo = 'mein-logo.png'; Hint = $false; Name = 'logo: aus dem Benutzerordner' },
    @{ Logo = 'vorlagen-logo.png'; Hint = $false; Name = 'logo: aus dem Vorlagen-Ordner' },
    @{ Logo = 'fehlt.png';     Hint = $true;  Name = 'logo: nicht gefunden -> ohne Logo' },
    @{ Logo = 'mein-logo.txt'; Hint = $true;  Name = 'logo: falsche Endung -> ohne Logo' })) {
  $noteText = "---`nlogo: $($case.Logo)`n---`n`nText.`n"
  [IO.File]::WriteAllText((Join-Path $logoDir 'notiz.md'), $noteText, (New-Object Text.UTF8Encoding $false))
  $r = Invoke-Convert @((Join-Path $logoDir 'notiz.md'), $logoPdf)
  $hinted = $r.Text -match 'Hinweis: Logo'
  if ($r.Code -ne 0) { Fail "$($case.Name): Exit $($r.Code)`n$($r.Text)" }
  elseif (-not (Test-PdfA $logoPdf)) { Fail "$($case.Name): PDF fehlt`n$($r.Text)" }
  elseif ($hinted -ne $case.Hint) { Fail "$($case.Name): Hinweis erwartet=$($case.Hint)`n$($r.Text)" }
  else { Ok $case.Name }
}
$env:USERPROFILE = $savedProfile
$env:MDO_TEMPLATES = $savedTemplates

# 3c) Standard: harte Umbrueche; --soft-breaks wird angenommen.
$r = Invoke-Convert @('--soft-breaks', $note, (Join-Path $outDir 'weich.pdf'))
if ($r.Code -ne 0 -or -not (Test-PdfA (Join-Path $outDir 'weich.pdf'))) { Fail "--soft-breaks: Exit $($r.Code)`n$($r.Text)" }
else { Ok '--soft-breaks' }

# 4) Fehlende Quelle: Exit 1, verstaendliche Meldung.
$r = Invoke-Convert @((Join-Path $inDir 'gibt es nicht.md'), (Join-Path $outDir 'x.pdf'))
if ($r.Code -ne 1 -or $r.Text -notmatch 'Quelle nicht gefunden') { Fail "fehlende Quelle: Exit $($r.Code)`n$($r.Text)" }
else { Ok 'Exit 1 bei fehlender Quelle' }

# 4b) Fehlschlag ohne MDO_NO_OPEN und ohne ausdrueckliche Ausgabe (so ruft der
#     Editor auf): sofort Exit 1, keine Rueckfrage. stdin bleibt offen, aber leer,
#     wie bei Node.js' spawn() - eine Rueckfrage wuerde hier haengen.
$psi = New-Object Diagnostics.ProcessStartInfo
$psi.FileName = (Get-Command powershell).Source
$psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $Convert + '" "' + (Join-Path $inDir 'gibt es nicht.md') + '"'
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
Remove-Item Env:\MDO_NO_OPEN
$proc = [Diagnostics.Process]::Start($psi)
$env:MDO_NO_OPEN = '1'
$errTask = $proc.StandardError.ReadToEndAsync()
$outTask = $proc.StandardOutput.ReadToEndAsync()
if (-not $proc.WaitForExit(60000)) {
  $proc.Kill()
  Fail 'Fehlschlag ohne MDO_NO_OPEN: haengt (wartet auf stdin)'
} else {
  $proc.WaitForExit()
  $text = $outTask.Result + $errTask.Result
  if ($proc.ExitCode -ne 1 -or $text -notmatch 'Quelle nicht gefunden') { Fail "Fehlschlag ohne MDO_NO_OPEN: Exit $($proc.ExitCode)`n$text" }
  else { Ok 'Fehlschlag ohne MDO_NO_OPEN und ohne Ausgabepfad: sofort Exit 1' }
}

# 5) Unbekannte Option: Exit 2.
$r = Invoke-Convert @('--gibt-es-nicht')
if ($r.Code -ne 2) { Fail "unbekannte Option: Exit $($r.Code)`n$($r.Text)" } else { Ok 'Exit 2 bei unbekannter Option' }

# 5a) '--' beendet die Optionen (Paritaet zu build.sh): danach ist auch ein Name mit
#     fuehrendem '-' eine Quelle.
$dashDir = Join-Path $Work 'strich'
New-Item -ItemType Directory -Force -Path $dashDir | Out-Null
[IO.File]::WriteAllText((Join-Path $dashDir '-strich.md'), "# Strich`n`nText.`n", (New-Object Text.UTF8Encoding $false))
Push-Location $dashDir
$r = Invoke-Convert @('--no-source', '--', '-strich.md', (Join-Path $dashDir 'strich.pdf'))
Pop-Location
if ($r.Code -ne 0) { Fail "'--' als Ende der Optionen: Exit $($r.Code)`n$($r.Text)" }
elseif (-not (Test-PdfA (Join-Path $dashDir 'strich.pdf'))) { Fail "'--': PDF fehlt`n$($r.Text)" }
else { Ok "'--' beendet die Optionen" }

# 5c) Umgeleitete Ausgabe ist UTF-8 (der Editor dekodiert UTF-8): ein Umlaut im
#     Dateinamen kommt unverfaelscht an. Der Umlaut entsteht zur Laufzeit (Datei ASCII).
$uml = [string][char]0x00DC + 'bersicht'
$umlNote = Join-Path $inDir "$uml.md"
[IO.File]::WriteAllText($umlNote, "# Text`n", (New-Object Text.UTF8Encoding $false))
$savedEnc = [Console]::OutputEncoding
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$r = Invoke-Convert @($umlNote, (Join-Path $outDir "$uml.pdf"))
[Console]::OutputEncoding = $savedEnc
if ($r.Code -ne 0) { Fail "Umlaut im Pfad: Exit $($r.Code)`n$($r.Text)" }
elseif (-not $r.Text.Contains("$uml.pdf")) { Fail "Umlaut im Pfad: Ausgabe nicht UTF-8`n$($r.Text)" }
else { Ok 'umgeleitete Ausgabe in UTF-8 (Umlaut im Pfad)' }

# 5b) Ohne Quelle: Hilfe, Exit 0, kein PDF (weder im Arbeitsordner noch im Pipeline-Ordner).
$noArgDir = Join-Path $Work 'ohne argumente'
New-Item -ItemType Directory -Force -Path $noArgDir | Out-Null
Push-Location $noArgDir
$r = Invoke-Convert @()
Pop-Location
$strayPdfs = @(Get-ChildItem -LiteralPath $noArgDir -Filter '*.pdf' -Recurse -ErrorAction SilentlyContinue) +
  @(Get-ChildItem -LiteralPath $Root -Filter '*.pdf' -ErrorAction SilentlyContinue)
if ($r.Code -ne 0) { Fail "ohne Argumente: Exit $($r.Code)`n$($r.Text)" }
elseif ($r.Text -notmatch 'Usage:') { Fail "ohne Argumente: keine Hilfe`n$($r.Text)" }
elseif ($r.Text -notmatch 'markdown-office --app \[notiz\.md') { Fail "ohne Argumente: Hilfe nennt --app nicht`n$($r.Text)" }
elseif ($strayPdfs.Count -gt 0) { Fail "ohne Argumente: PDF erzeugt: $($strayPdfs.FullName -join ', ')" }
else { Ok 'ohne Argumente: Hilfe, Exit 0, kein PDF' }

# 6) --version und -Version.
foreach ($v in @('--version', '-Version')) {
  $r = Invoke-Convert @($v)
  if ($r.Code -ne 0 -or $r.Text -notmatch 'markdown-office') { Fail "$v`: Exit $($r.Code)`n$($r.Text)" } else { Ok $v }
}

# Vorlagen-Sets: eigenes Set ueber MDO_TEMPLATES, --template vor dem Frontmatter,
# Datei relativ zur Notiz, eigenes memo vor dem mitgelieferten, Fehlerfaelle (Exit 1 / 2).
$env:MDO_TEMPLATES = Join-Path $Fixtures 'templates'
$setNote = Join-Path $inDir 'set notiz.md'
[IO.File]::WriteAllText($setNote, "---`ntitle: `"Set-Test`"`ntemplate: probe`n---`n`n# Kapitel`n", (New-Object Text.UTF8Encoding $false))
$setPdf = Join-Path $outDir 'set.pdf'
$r = Invoke-Convert @($setNote, $setPdf)
if ($r.Code -ne 0 -or -not (Test-PdfA $setPdf)) { Fail "Set probe: Exit $($r.Code)`n$($r.Text)" }
elseif (-not (Test-PdfMarker $setPdf 'SET-PROBE')) { Fail 'Set probe: Marker SET-PROBE fehlt, falsche Vorlage' }
else { Ok 'Set aus MDO_TEMPLATES' }

$folderPdf = Join-Path $outDir 'folder.pdf'
$r = Invoke-Convert @('--template', 'folderset', $setNote, $folderPdf)
if ($r.Code -ne 0 -or -not (Test-PdfA $folderPdf)) { Fail "Set-Ordner: Exit $($r.Code)`n$($r.Text)" }
elseif (-not (Test-PdfMarker $folderPdf 'SET-FOLDER')) { Fail 'Set-Ordner: Marker SET-FOLDER fehlt' }
else { Ok 'Set-Ordner <name>\<name>.typ im Benutzerordner' }

$r = Invoke-Convert @('--template', 'gibt-es-nicht', $setNote, (Join-Path $outDir 'x.pdf'))
if ($r.Code -ne 1 -or $r.Text -notmatch 'Vorlage nicht gefunden: gibt-es-nicht') { Fail "unbekanntes Set: Exit $($r.Code)`n$($r.Text)" } else { Ok 'unbekanntes Set: Exit 1' }

$r = Invoke-Convert @('--template=memo', $setNote, (Join-Path $outDir 'cli.pdf'))
if ($r.Code -ne 0) { Fail "--template=memo: Exit $($r.Code)`n$($r.Text)" }
elseif (Test-PdfMarker (Join-Path $outDir 'cli.pdf') 'SET-PROBE') { Fail '--template=memo: Marker SET-PROBE vorhanden, falsche Vorlage' }
else { Ok '--template=memo' }

$r = Invoke-Convert @('--template')
if ($r.Code -ne 2) { Fail "--template ohne Wert: Exit $($r.Code)" } else { Ok '--template ohne Wert: Exit 2' }

Copy-Item -LiteralPath (Join-Path $Fixtures 'templates\probe.typ') -Destination (Join-Path $inDir 'eigene vorlage.typ')
$pathNote = Join-Path $inDir 'pfad.md'
[IO.File]::WriteAllText($pathNote, "---`ntemplate: ./eigene vorlage.typ`n---`n`n# Pfad`n", (New-Object Text.UTF8Encoding $false))
# Wieder der leere Vorlagen-Ordner (siehe oben).
$env:MDO_TEMPLATES = $EmptyTemplates
$r = Invoke-Convert @($pathNote, (Join-Path $outDir 'pfad.pdf'))
if ($r.Code -ne 0) { Fail "Vorlage als Datei: Exit $($r.Code)`n$($r.Text)" }
elseif (-not (Test-PdfMarker (Join-Path $outDir 'pfad.pdf') 'SET-PROBE')) { Fail 'Vorlage als Datei: Marker SET-PROBE fehlt' }
else { Ok 'Vorlage als Datei relativ zur Notiz' }

# Ein eigenes memo im Benutzerordner (Pfad mit Leerzeichen) ueberschattet das mitgelieferte.
$shadowDir = Join-Path $Work 'Eigene Vorlagen'
New-Item -ItemType Directory -Force -Path $shadowDir | Out-Null
Copy-Item -LiteralPath (Join-Path $Fixtures 'templates\probe.typ') -Destination (Join-Path $shadowDir 'memo.typ')
$env:MDO_TEMPLATES = $shadowDir
$plainNote = Join-Path $inDir 'ohne schluessel.md'
[IO.File]::WriteAllText($plainNote, "# Ohne Schluessel`n", (New-Object Text.UTF8Encoding $false))
$r = Invoke-Convert @($plainNote, (Join-Path $outDir 'schatten.pdf'))
$env:MDO_TEMPLATES = $EmptyTemplates
if ($r.Code -ne 0) { Fail "eigenes memo: Exit $($r.Code)`n$($r.Text)" }
elseif (-not (Test-PdfMarker (Join-Path $outDir 'schatten.pdf') 'SET-PROBE')) { Fail 'eigenes memo: Marker SET-PROBE fehlt, mitgeliefertes Set lief' }
else { Ok 'Benutzerordner vor mitgelieferten Sets' }

# Absender-Profil: Vorlagen-Ordner, Tippfehler -> Exit 1, Profil auf anderem Laufwerk.
$profVorl = Join-Path $Work 'profil vorlagen'
$profNote = Join-Path $Work 'profil notiz'
New-Item -ItemType Directory -Force -Path (Join-Path $profVorl 'profiles'), (Join-Path $profNote 'profiles') | Out-Null
Copy-Item -LiteralPath (Join-Path $Fixtures 'profiles\testprofil.yaml'), (Join-Path $Fixtures 'profiles\sig.svg') -Destination (Join-Path $profVorl 'profiles')
Copy-Item -LiteralPath (Join-Path $Fixtures 'templates\profile.typ') -Destination $profVorl
$savedTemplates = $env:MDO_TEMPLATES
$env:MDO_TEMPLATES = $profVorl
$brief = Join-Path $profNote 'brief.md'
[IO.File]::WriteAllText($brief, "---`ntemplate: profile`nprofile: testprofil`n---`n`nText.`n", (New-Object Text.UTF8Encoding $false))
$p1 = Join-Path $outDir 'p1.pdf'
$r = Invoke-Convert @($brief, $p1)
if ($r.Code -ne 0) { Fail "profile: Vorlagen-Ordner: Exit $($r.Code)`n$($r.Text)" }
elseif (-not (Test-PdfMarker $p1 'PROFILE-TEST')) { Fail 'profile: falsche Vorlage' }
else { Ok 'profile: aus dem Vorlagen-Ordner' }
[IO.File]::WriteAllText((Join-Path $profNote 'falsch.md'), "---`ntemplate: profile`nprofile: testprofli`n---`n`nText.`n", (New-Object Text.UTF8Encoding $false))
$p5 = Join-Path $outDir 'p5.pdf'
$r = Invoke-Convert @((Join-Path $profNote 'falsch.md'), $p5)
if ($r.Code -ne 1 -or $r.Text -notmatch 'Profil nicht gefunden: testprofli') { Fail "profile: Tippfehler: Exit $($r.Code)`n$($r.Text)" }
elseif (Test-PdfA $p5) { Fail 'profile: Tippfehler erzeugt trotzdem ein PDF' }
else { Ok 'profile: Tippfehler -> Exit 1' }
if ($OtherTemp) {
  # Notiz und Profil auf einem anderen Laufwerk: der Profil-Ordner wird komplett bereitgestellt.
  $pdrv = Join-Path $OtherTemp ('mdo profil platte ' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path (Join-Path $pdrv 'profiles') | Out-Null
  Copy-Item -LiteralPath (Join-Path $Fixtures 'profiles\testprofil.yaml'), (Join-Path $Fixtures 'profiles\sig.svg') -Destination (Join-Path $pdrv 'profiles')
  $pdrvNote = Join-Path $pdrv 'brief.md'
  [IO.File]::WriteAllText($pdrvNote, "---`ntemplate: profile`nprofile: testprofil`n---`n`nText.`n", (New-Object Text.UTF8Encoding $false))
  $pdrvPdf = Join-Path $pdrv 'brief.pdf'
  $r = Invoke-Convert @($pdrvNote, $pdrvPdf)
  if ($r.Code -ne 0) { Fail "profile: anderes Laufwerk: Exit $($r.Code)`n$($r.Text)" }
  elseif (-not (Test-PdfA $pdrvPdf)) { Fail 'profile: anderes Laufwerk: PDF fehlt' }
  else { Ok 'profile: Profil auf anderem Laufwerk (Unterschrift aus dem bereitgestellten Ordner)' }
  Remove-Item -LiteralPath $pdrv -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Skip 'profile: anderes Laufwerk (kein Temp-Ordner auf einem anderen Laufwerk als das Repo)'
}
$env:MDO_TEMPLATES = $EmptyTemplates

Set-Location $Repo
Remove-Item -LiteralPath $EmptyTemplates -Recurse -Force -ErrorAction SilentlyContinue

if ($failed -gt 0) { Write-Host "$failed Test(s) fehlgeschlagen." -ForegroundColor Red; exit 1 }
Write-Host 'Alle Windows-Tests bestanden.' -ForegroundColor Green
