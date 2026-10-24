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
  Dazu der Staging-Ordner (spiegelt test_sandbox in test-pdf.sh): eine Notiz liest nur
  sich selbst und die Dateien, die sie sichtbar einbindet.

  Aufruf wie markdown-office: node cli.js (schreibt das Manifest MDO_MANIFEST und ruft
  convert.ps1 daneben); ohne Manifest exportiert convert.ps1 nicht. Einige Faelle rufen
  convert.ps1 direkt mit einem selbst geschriebenen Manifest auf, um die Pruefungen des
  Skripts selbst zu sehen (der Wrapper lehnt vieles schon vorher ab).

  Layout: getestet werden cli.js und convert.ps1 in MDO_PIPELINE_ROOT mit MDO_SETS_DIR.
  Ohne MDO_PIPELINE_ROOT gilt das Entwicklungs-Layout build\pipeline-dev\ (entspricht dem
  gepackten Layout der App). Vorher ausfuehren: npm run assets (baut auch cli.js).
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
# Aufruf wie markdown-office: node cli.js. cli.js ruft das convert.ps1 neben sich auf; unter Git
# Bash ist es eine Kopie (dev-layout.sh), die dem getesteten Skript entsprechen muss.
$Cli = Join-Path $Root 'cli.js'
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not (Test-Path -LiteralPath $Cli -PathType Leaf) -or -not $Node) {
  Write-Host "FEHLER: $Cli oder node fehlt (npm run assets)" -ForegroundColor Red
  exit 1
}
$layoutConvert = Join-Path $Root 'convert.ps1'
if ([IO.File]::ReadAllText($layoutConvert) -ne [IO.File]::ReadAllText($Convert)) {
  Write-Host "FEHLER: $layoutConvert ist veraltet (bash pipeline/tests/dev-layout.sh)" -ForegroundColor Red
  exit 1
}
# Staging-Ordner, die schon vor dem Test im Temp-Ordner lagen (fremde Laeufe); am Ende darf kein
# neuer dazugekommen sein.
$StagesBefore = @(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter 'mdo-stage-*' -Force -ErrorAction SilentlyContinue |
  ForEach-Object { $_.FullName })
# Arbeitsordner im Repo.
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

# Exportieren wie markdown-office (node cli.js -> Manifest -> powershell -File convert.ps1),
# Ausgabe einsammeln. stderr-Zeilen als Text ("$_"), nicht als formatierte Fehlerdatensaetze.
function Invoke-Convert {
  param([string[]]$ArgList)
  $out = & $Node $Cli @ArgList 2>&1 | ForEach-Object { "$_" } | Out-String
  return @{ Code = $LASTEXITCODE; Text = $out }
}

# Ein Manifest wie vom Wrapper, aber selbst geschrieben: nur die Notiz, keine Bilder, kein Logo,
# kein Profil. Damit laeuft convert.ps1 direkt und zeigt seine eigenen Pruefungen.
function New-TestManifest([string]$NotePath) {
  $file = Join-Path $Work ('manifest-' + [Guid]::NewGuid().ToString('N') + '.json')
  $json = @{ note = $NotePath; images = @(); logo = $null; profile = $null } | ConvertTo-Json
  [IO.File]::WriteAllText($file, $json, (New-Object Text.UTF8Encoding $false))
  return $file
}

# convert.ps1 direkt (powershell -File) mit einem Manifest aufrufen.
function Invoke-ConvertDirect {
  param([string[]]$ArgList, [string]$Manifest)
  $saved = $env:MDO_MANIFEST
  if ($Manifest) { $env:MDO_MANIFEST = $Manifest } else { Remove-Item Env:\MDO_MANIFEST -ErrorAction SilentlyContinue }
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File $Convert @ArgList 2>&1 | ForEach-Object { "$_" } | Out-String
  $code = $LASTEXITCODE
  if ($saved) { $env:MDO_MANIFEST = $saved } else { Remove-Item Env:\MDO_MANIFEST -ErrorAction SilentlyContinue }
  return @{ Code = $code; Text = $out }
}

# Rohe Bytes des PDFs als Text (Objekt-Woerterbuecher und XMP stehen unkomprimiert darin).
function Get-PdfRaw([string]$pdf) {
  if (-not (Test-Path -LiteralPath $pdf -PathType Leaf)) { return '' }
  return [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($pdf))
}

# Seitenzahl aus dem Seitenbaum (/Type/Pages ... /Count n); -1, wenn nicht lesbar.
function Get-PdfPages([string]$pdf) {
  $raw = Get-PdfRaw $pdf
  $m = [regex]::Match($raw, '/Type\s*/Pages\b[^>]*?/Count\s+(\d+)')
  if (-not $m.Success) { $m = [regex]::Match($raw, '/Count\s+(\d+)[^>]*?/Type\s*/Pages\b') }
  if ($m.Success) { return [int]$m.Groups[1].Value }
  return -1
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
Copy-Item -LiteralPath (Join-Path $Fixtures 'toptitle-meta.md') -Destination (Join-Path $inDir 'meine notiz.md')
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

# Staging-Ordner, die nach einem Build noch in $Dirs liegen.
function Get-StageLeftovers([string[]]$Dirs) {
  return @(foreach ($d in $Dirs) {
    if ($d) { Get-ChildItem -LiteralPath $d -Directory -Filter 'mdo-stage-*' -Force -ErrorAction SilentlyContinue }
  })
}

# 3b) Notiz auf einem ANDEREN Laufwerk als der Pipeline-Ordner, Aufruf aus dem
#     Laufwerks-Wurzelverzeichnis der Pipeline. Ausgabe ebenfalls auf dem anderen
#     Laufwerk. Der Staging-Ordner (im Temp-Ordner) muss danach weg.
if ($OtherTemp) {
  $otherRoot = [IO.Path]::GetPathRoot($OtherTemp)
  $drvTmp  = Join-Path $OtherTemp ('mdo andere platte ' + [Guid]::NewGuid().ToString('N'))
  $drvDir  = Join-Path $drvTmp 'Notizen mit Leerzeichen'
  $drvOut  = Join-Path $drvTmp 'Export Ziel'
  New-Item -ItemType Directory -Force -Path $drvOut | Out-Null
  $drvNote = New-DriveNote $drvDir
  $drvPdf = Join-Path $drvOut 'notiz.pdf'
  $r = Invoke-Convert @($drvNote, $drvPdf)
  $leftover = @(Get-StageLeftovers @([IO.Path]::GetTempPath(), $env:LOCALAPPDATA, (Get-Location).Path, $Root, $drvDir, $drvOut))
  if ($r.Code -ne 0) { Fail "anderes Laufwerk: Exit $($r.Code)`n$($r.Text)" }
  elseif (-not (Test-PdfA $drvPdf)) { Fail "anderes Laufwerk: PDF fehlt am Zielpfad`n$($r.Text)" }
  elseif ($r.Text -match 'nicht gefunden') { Fail "anderes Laufwerk: Bild/Logo nicht gefunden`n$($r.Text)" }
  elseif ($leftover.Count -gt 0) { Fail "anderes Laufwerk: Staging-Ordner nicht entfernt" }
  else { Ok "Notiz auf anderem Laufwerk ($otherRoot) als die Pipeline ($([IO.Path]::GetPathRoot($Root)))" }

  # 3b2) Wie der Editor: Arbeitsordner = Notizordner, und TEMP, TMP und LOCALAPPDATA
  #      liegen ebenfalls auf dem anderen Laufwerk. Der Staging-Ordner liegt dann dort,
  #      mit Kopien von lib\ und vendor\ (Fonts und Pakete bleiben in der Pipeline).
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
  $leftover = @(Get-StageLeftovers @($edTemp, $edLocal, $edDir, $Root))
  if ($r.Code -ne 0) { Fail "Editor-Fall (anderes Laufwerk, Arbeitsordner = Notizordner): Exit $($r.Code)`n$($r.Text)" }
  elseif (-not (Test-PdfA $edPdf)) { Fail "Editor-Fall: PDF fehlt neben der Notiz`n$($r.Text)" }
  elseif ($r.Text -match 'nicht gefunden') { Fail "Editor-Fall: Bild/Logo nicht gefunden`n$($r.Text)" }
  elseif ($leftover.Count -gt 0) { Fail 'Editor-Fall: Staging-Ordner nicht entfernt' }
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

# Offline-Paketablage: @preview/cades (mit jogs) aus vendor\packages, ohne Netz; ein nicht
# mitgeliefertes Paket bricht vor Typst mit Exit 1 ab (spiegelt test-pdf.sh).
$qrPdf = Join-Path $outDir 'qr.pdf'
$r = Invoke-Convert @('--template', 'qr', $setNote, $qrPdf)
if ($r.Code -ne 0 -or -not (Test-PdfMarker $qrPdf 'QR-TEST')) { Fail "QR-Paket: Exit $($r.Code)`n$($r.Text)" } else { Ok 'QR-Paket aus der Offline-Ablage' }
$r = Invoke-Convert @('--template', 'netimport', $setNote, (Join-Path $outDir 'net.pdf'))
if ($r.Code -ne 1 -or $r.Text -notmatch 'Paket nicht mitgeliefert: @preview/gibtsnicht:1.0.0') { Fail "fremdes Paket: Exit $($r.Code)`n$($r.Text)" } else { Ok 'fremdes Paket: Exit 1' }
# Fail closed: ungueltige Angabe (Grossbuchstaben, _) und ein Import in einer Hilfsdatei des Set-Ordners.
$r = Invoke-Convert @('--template', 'netupper', $setNote, (Join-Path $outDir 'net.pdf'))
if ($r.Code -ne 1 -or $r.Text -notmatch 'Paket nicht mitgeliefert: @preview/Gibts_Nicht:1.0.0') { Fail "ungueltige Paketangabe: Exit $($r.Code)`n$($r.Text)" } else { Ok 'ungueltige Paketangabe: Exit 1' }
$r = Invoke-Convert @('--template', 'nethelper', $setNote, (Join-Path $outDir 'net.pdf'))
if ($r.Code -ne 1 -or $r.Text -notmatch 'Paket nicht mitgeliefert: @preview/gibtsnicht:2.0.0') { Fail "Import in Hilfsdatei: Exit $($r.Code)`n$($r.Text)" } else { Ok 'Import in Hilfsdatei: Exit 1' }
# Verkettete Paketangabe (kein Textscan sieht sie): der gesperrte Proxy verhindert den Download,
# die Paketablage bleibt unveraendert.
$storeDir = Join-Path $env:MDO_PIPELINE_ROOT 'vendor\packages'
$storeBefore = (Get-ChildItem -LiteralPath $storeDir -Recurse -Force | ForEach-Object { $_.FullName }) -join "`n"
$concatPdf = Join-Path $outDir 'concat.pdf'
$r = Invoke-Convert @('--template', 'netconcat', $setNote, $concatPdf)
$storeAfter = (Get-ChildItem -LiteralPath $storeDir -Recurse -Force | ForEach-Object { $_.FullName }) -join "`n"
if ($r.Code -eq 0 -or (Test-Path -LiteralPath $concatPdf)) { Fail "verkettete Paketangabe: Build ohne Fehler (Download nicht gesperrt?)`n$($r.Text)" }
elseif ($storeAfter -ne $storeBefore) { Fail 'verkettete Paketangabe: Paketablage veraendert' }
else { Ok 'verkettete Paketangabe: kein Download, Ablage unveraendert' }
# Der gesperrte Proxy und das Entfernen der TYPST_*-Variablen gelten nur um die Typst-Aufrufe:
# convert.ps1 IM SELBEN PROZESS (&, mit selbst geschriebenem Manifest) aufrufen (einmal
# erfolgreich, einmal mit Fehler) und pruefen, dass die Variablen danach wieder die vorherigen
# Werte haben (kein Erben durch den PDF-Betrachter oder den Aufrufer). Eine TYPST_FONT_PATHS von
# aussen darf den Build nicht stoeren (sie wird fuer Typst entfernt).
$proxyVars = @('HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'TYPST_FONT_PATHS', 'MDO_MANIFEST')
$proxySaved = @{}
foreach ($v in $proxyVars) { $proxySaved[$v] = [Environment]::GetEnvironmentVariable($v, 'Process') }
[Environment]::SetEnvironmentVariable('HTTPS_PROXY', 'http://sentinel.invalid:1', 'Process')
[Environment]::SetEnvironmentVariable('HTTP_PROXY', $null, 'Process')
[Environment]::SetEnvironmentVariable('ALL_PROXY', 'http://sentinel.invalid:2', 'Process')
[Environment]::SetEnvironmentVariable('NO_PROXY', 'sentinel.invalid', 'Process')
[Environment]::SetEnvironmentVariable('TYPST_FONT_PATHS', 'X:\mdo-sentinel', 'Process')
[Environment]::SetEnvironmentVariable('MDO_MANIFEST', (New-TestManifest $setNote), 'Process')
$inProcPdf = Join-Path $outDir 'inproc.pdf'
$inProcOut = & $Convert $setNote $inProcPdf *>&1 | Out-String
$okRun = ($LASTEXITCODE -eq 0) -and (Test-PdfA $inProcPdf)
$null = & $Convert '--template' 'netconcat' $setNote (Join-Path $outDir 'inproc-net.pdf') *>&1
$after = @($env:HTTPS_PROXY, $env:HTTP_PROXY, $env:ALL_PROXY, $env:NO_PROXY, $env:TYPST_FONT_PATHS)
foreach ($v in $proxyVars) { [Environment]::SetEnvironmentVariable($v, $proxySaved[$v], 'Process') }
if (-not $okRun) { Fail "Proxy-Wiederherstellung: Build im selben Prozess fehlgeschlagen`n$inProcOut" }
elseif ($after[0] -ne 'http://sentinel.invalid:1' -or $after[1] -or $after[2] -ne 'http://sentinel.invalid:2' -or
  $after[3] -ne 'sentinel.invalid' -or $after[4] -ne 'X:\mdo-sentinel') {
  Fail "Variablen nach dem Build veraendert: HTTPS_PROXY=$($after[0]) HTTP_PROXY=$($after[1]) ALL_PROXY=$($after[2]) NO_PROXY=$($after[3]) TYPST_FONT_PATHS=$($after[4])"
} else { Ok 'Proxy- und TYPST_*-Variablen nach dem Build unveraendert (auch nach einem Fehler)' }

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
# Profile des Sets: Vorlagen\<set>\profiles. nurset.yaml liegt nur dort (nicht in
# Vorlagen\profiles, das beim flachen Set profile.typ auch der Set-Ordner ist), also beweist ein
# erfolgreicher Export den neuen Suchort; die Fehlermeldung nennt ihn ebenfalls.
$setProf = Join-Path (Join-Path $profVorl 'profile') 'profiles'
New-Item -ItemType Directory -Force -Path $setProf | Out-Null
Copy-Item -LiteralPath (Join-Path $Fixtures 'profiles\testprofil.yaml') -Destination (Join-Path $setProf 'nurset.yaml')
Copy-Item -LiteralPath (Join-Path $Fixtures 'profiles\sig.svg') -Destination $setProf
[IO.File]::WriteAllText((Join-Path $profNote 'set.md'), "---`ntemplate: profile`nprofile: nurset`n---`n`nText.`n", (New-Object Text.UTF8Encoding $false))
$p6 = Join-Path $outDir 'p6.pdf'
$r = Invoke-Convert @((Join-Path $profNote 'set.md'), $p6)
if ($r.Code -ne 0) { Fail "profile: Vorlagen\<set>\profiles: Exit $($r.Code)`n$($r.Text)" }
elseif (-not (Test-PdfA $p6)) { Fail 'profile: Vorlagen\<set>\profiles: PDF fehlt' }
else { Ok 'profile: aus Vorlagen\<set>\profiles' }
$r = Invoke-Convert @((Join-Path $profNote 'falsch.md'), $p5)
if (-not $r.Text.Contains($setProf)) { Fail "profile: Meldung nennt Vorlagen\<set>\profiles nicht`n$($r.Text)" }
else { Ok 'profile: Meldung nennt Vorlagen\<set>\profiles' }
if ($OtherTemp) {
  # Notiz und Profil auf einem anderen Laufwerk: Profil und Unterschrift kommen in den Staging-Ordner.
  $pdrv = Join-Path $OtherTemp ('mdo profil platte ' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path (Join-Path $pdrv 'profiles') | Out-Null
  Copy-Item -LiteralPath (Join-Path $Fixtures 'profiles\testprofil.yaml'), (Join-Path $Fixtures 'profiles\sig.svg') -Destination (Join-Path $pdrv 'profiles')
  $pdrvNote = Join-Path $pdrv 'brief.md'
  [IO.File]::WriteAllText($pdrvNote, "---`ntemplate: profile`nprofile: testprofil`n---`n`nText.`n", (New-Object Text.UTF8Encoding $false))
  $pdrvPdf = Join-Path $pdrv 'brief.pdf'
  $r = Invoke-Convert @($pdrvNote, $pdrvPdf)
  if ($r.Code -ne 0) { Fail "profile: anderes Laufwerk: Exit $($r.Code)`n$($r.Text)" }
  elseif (-not (Test-PdfA $pdrvPdf)) { Fail 'profile: anderes Laufwerk: PDF fehlt' }
  else { Ok 'profile: Profil auf anderem Laufwerk (Unterschrift aus dem Staging-Ordner)' }
  Remove-Item -LiteralPath $pdrv -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Skip 'profile: anderes Laufwerk (kein Temp-Ordner auf einem anderen Laufwerk als das Repo)'
}
$env:MDO_TEMPLATES = $EmptyTemplates

# ---------------------------------------------------------------------------
# Staging-Ordner (spiegelt test_sandbox in test-pdf.sh): eine Notiz liest nur sich selbst und die
# Dateien, die sie sichtbar einbindet. Typst sieht als Wurzel nur den Staging-Ordner; ein Pfad wie
# /a/.../canary.txt (Laufwerk weg, wie die alte Pipeline mit --root <Laufwerk> ihn las) zeigt
# daher ins Leere. Den Text eines PDFs kann dieser Test nicht lesen (komprimiert, Glyphen):
# Lesbarkeit pruefen Notizen mit #assert(read(...).contains(...)), Marker der Vorlagen stehen im
# Titel (XMP, unkomprimiert).
# ---------------------------------------------------------------------------
$utf8 = New-Object Text.UTF8Encoding $false
# Eigener Ordner ohne Leerzeichen: die Kanarienvoegel-Pfade stehen in mitex-Befehlen der Notizen
# (\includegraphics{...}), wo ein Leerzeichen den Pfad teilen koennte. Entfernt ohne Remove-Item
# -Recurse, das in Windows PowerShell 5.1 Junctions folgt (die Links zeigen nur hier hinein).
$sbRoot = Join-Path $Repo 'build\tmp\mdo-sandbox'
if (Test-Path -LiteralPath $sbRoot) { [IO.Directory]::Delete($sbRoot, $true) }
$sb = Join-Path $sbRoot 'sandbox'
$sbNote = Join-Path $sb 'notiz'
$geheim = Join-Path $sbRoot 'geheim'
New-Item -ItemType Directory -Force -Path $sbNote, (Join-Path $sb 'bilder'), $geheim | Out-Null
[IO.File]::WriteAllText((Join-Path $geheim 'canary.txt'), "CANARY-GEHEIM`n", $utf8)
Copy-Item -LiteralPath (Join-Path $Fixtures 'logo.png') -Destination (Join-Path $geheim 'canary.png')
# Liegt neben der Notiz, ist aber nicht verlinkt: nur gefaelschte Probe-Metadaten nennen es.
Copy-Item -LiteralPath (Join-Path $Fixtures 'logo.png') -Destination (Join-Path $sbNote 'canary.png')
# Wurzelrelative Typst-Form der Kanarienvoegel (so las die alte Pipeline jede Datei des Laufwerks).
function ConvertTo-RootRel([string]$P) { return ($P -replace '\\', '/') -replace '^[A-Za-z]:', '' }
$canaryTxt = ConvertTo-RootRel (Join-Path $geheim 'canary.txt')
$canaryPng = ConvertTo-RootRel (Join-Path $geheim 'canary.png')
$notFound = 'error: file not found'

# Links anlegen: Symlinks brauchen unter Windows ein Recht (Admin oder Entwicklermodus; der
# CI-Runner hat es), Junctions und harte Links nicht. $false, wenn es nicht geht.
function New-TestLink([string]$Type, [string]$Path, [string]$Target) {
  try {
    New-Item -ItemType $Type -Path $Path -Value $Target -ErrorAction Stop | Out-Null
    return $true
  } catch {
    Skip "$Type $Path nicht anlegbar: $($_.Exception.Message)"
    return $false
  }
}

# Notiz mit der Zeile exportieren (ueber cli.js). Mit $Want muss der Export genau damit scheitern
# und darf kein PDF hinterlassen; mit '' muss er gelingen, und das PDF darf weder den
# Kanarienvogel noch ein Bild enthalten. Gibt das Ergebnis zurueck (Code, Text, Pdf).
function Invoke-Hostile {
  param([string]$Name, [string]$Line, [string]$Want, [string[]]$Opts = @(), [string]$Templates = '')
  $pdf = Join-Path $outDir "sb-$Name.pdf"
  if (Test-Path -LiteralPath $pdf) { Remove-Item -LiteralPath $pdf -Force }
  [IO.File]::WriteAllText((Join-Path $sbNote "$Name.md"), "# Feind`n`n$Line`n`nENDE.`n", $utf8)
  $savedTpl = $env:MDO_TEMPLATES
  if ($Templates) { $env:MDO_TEMPLATES = $Templates }
  Push-Location $sbNote
  $r = Invoke-Convert (@($Opts) + @("$Name.md", $pdf))
  Pop-Location
  $env:MDO_TEMPLATES = $savedTpl
  $r.Pdf = $pdf
  $r.Ok = $true
  if ($Want) {
    if ($r.Code -eq 0) { Fail "sandbox ${Name}: Export gelang, erwartet: $Want`n$($r.Text)"; $r.Ok = $false }
    elseif (Test-Path -LiteralPath $pdf) { Fail "sandbox ${Name}: gescheiterter Export hinterlaesst ein PDF"; $r.Ok = $false }
    elseif ($r.Text -notmatch $Want) { Fail "sandbox ${Name}: unerwarteter Fehler:`n$($r.Text)"; $r.Ok = $false }
    return $r
  }
  $raw = Get-PdfRaw $pdf
  if ($r.Code -ne 0) { Fail "sandbox ${Name}: Export fehlgeschlagen: Exit $($r.Code)`n$($r.Text)"; $r.Ok = $false }
  elseif (-not (Test-PdfA $pdf)) { Fail "sandbox ${Name}: PDF fehlt`n$($r.Text)"; $r.Ok = $false }
  elseif ($raw.Contains('CANARY-GEHEIM')) { Fail "sandbox ${Name}: Kanarienvogel im PDF"; $r.Ok = $false }
  elseif ($raw -match '/Subtype\s*/Image') { Fail "sandbox ${Name}: fremdes Bild im PDF"; $r.Ok = $false }
  return $r
}

$forgeMeta = '$\text{\label{#metadata("canary.png")<mdo-image>}}$'
$forgeUse = '$\text{\label{#(sys.inputs.at("images", default: none),).filter(f => f != none).map(f => image(json(f).at("canary.png"))).join()}}$'
$fixtureTemplates = Join-Path $Fixtures 'templates'
$sbOk = $true
# Einstellung des Sets: memo hat raw-typst aus, der Kommentar bleibt ein Kommentar (Export gelingt).
$sbOk = (Invoke-Hostile 'memo-raw-aus' ('<!--raw-typst #read("' + $canaryTxt + '") -->') '').Ok -and $sbOk
# Ein eigenes Set mit raw-typst an (probe): die Notiz laeuft als Typst-Code, sieht aber nur den
# Staging-Ordner.
$sbOk = (Invoke-Hostile 'raw-probe' ('<!--raw-typst #read("' + $canaryTxt + '") -->') $notFound @('--template', 'probe') $fixtureTemplates).Ok -and $sbOk
$sbOk = (Invoke-Hostile 'raw-probe-bild' ('<!--raw-typst #image("' + $canaryPng + '") -->') $notFound @('--template', 'probe') $fixtureTemplates).Ok -and $sbOk
$sbOk = (Invoke-Hostile 'label' ('$\text{\label{#read("' + $canaryTxt + '")}}$') $notFound).Ok -and $sbOk
$sbOk = (Invoke-Hostile 'graphics' ('$\includegraphics{' + $canaryPng + '}$') $notFound).Ok -and $sbOk
# Die gefaelschte Quelle steht in der Zuordnung als "" (fehlt): image("") scheitert.
$sbOk = (Invoke-Hostile 'forged' "$forgeMeta $forgeUse" 'error: (file not found|failed to load file)').Ok -and $sbOk
# Ein Link auf eine Nicht-Bilddatei kommt nicht in den Staging-Ordner: Platzhalter statt Abbruch.
$r = Invoke-Hostile 'textlink' '![](../../geheim/canary.txt)' ''
if ($r.Ok -and $r.Text -notmatch 'Bild nicht gefunden: \.\./\.\./geheim/canary\.txt') {
  Fail "sandbox textlink: keine Warnung 'Bild nicht gefunden'`n$($r.Text)"; $r.Ok = $false
}
$sbOk = $r.Ok -and $sbOk
if ($sbOk) { Ok 'sandbox: raw-typst, mitex (\label, \includegraphics), Nicht-Bild-Link, gefaelschte Probe lesen nichts' }

# Eine von der Notiz genannte Vorlage: nur eine echte .typ-Datei unter Notiz- oder Vorlagen-
# Ordner, und nur diese eine Datei kommt in den Staging-Ordner. Geprueft ueber cli.js (der Wrapper
# lehnt ab) und direkt mit Manifest (convert.ps1 lehnt selbst ab).
$refused = 'Vorlage muss eine \.typ-Datei im Ordner der Notiz oder im Vorlagen-Ordner sein'
New-Item -ItemType Directory -Force -Path (Join-Path $geheim 'evil') | Out-Null
[IO.File]::WriteAllText((Join-Path $geheim 'evil\evil.typ'), "#read(`"canary.txt`")`n", $utf8)
Copy-Item -LiteralPath (Join-Path $geheim 'canary.txt') -Destination (Join-Path $geheim 'evil')
$tplVals = @()
if (New-TestLink 'SymbolicLink' (Join-Path $sbNote 'evil.typ') (Join-Path $geheim 'canary.txt')) { $tplVals += './evil.typ' }
if (New-TestLink 'Junction' (Join-Path $sbNote 'evil') (Join-Path $geheim 'evil')) { $tplVals += './evil/evil.typ' }
if (New-TestLink 'HardLink' (Join-Path $sbNote 'hart.typ') (Join-Path $geheim 'canary.txt')) { $tplVals += './hart.typ' }
$tplNote = Join-Path $sbNote 'tpl.md'
$tplPdf = Join-Path $outDir 'sb-tpl.pdf'
$tplOk = $true
foreach ($tval in $tplVals) {
  [IO.File]::WriteAllText($tplNote, "---`ntemplate: $tval`n---`n`nText.`n", $utf8)
  $want = $refused + ': ' + [regex]::Escape($tval)
  Push-Location $sbNote
  $viaCli = Invoke-Convert @('tpl.md', $tplPdf)
  $direct = Invoke-ConvertDirect @('tpl.md', $tplPdf) (New-TestManifest $tplNote)
  Pop-Location
  foreach ($pair in @(@('cli.js', $viaCli), @('convert.ps1 direkt', $direct))) {
    $rr = $pair[1]
    if ($rr.Code -eq 0 -or (Test-Path -LiteralPath $tplPdf) -or $rr.Text -notmatch $want) {
      Fail "sandbox tpl $tval ($($pair[0])): nicht abgelehnt: Exit $($rr.Code)`n$($rr.Text)"; $tplOk = $false
      if (Test-Path -LiteralPath $tplPdf) { Remove-Item -LiteralPath $tplPdf -Force }
    }
  }
}
# Gegenprobe direkt: eine echte .typ neben der Notiz besteht die Pruefung des Skripts.
Copy-Item -LiteralPath (Join-Path $Fixtures 'templates\probe.typ') -Destination (Join-Path $sbNote 'echt.typ')
[IO.File]::WriteAllText($tplNote, "---`ntemplate: ./echt.typ`n---`n`nText.`n", $utf8)
Push-Location $sbNote
$direct = Invoke-ConvertDirect @('tpl.md', $tplPdf) (New-TestManifest $tplNote)
Pop-Location
if ($direct.Code -ne 0 -or -not (Test-PdfMarker $tplPdf 'SET-PROBE')) {
  Fail "sandbox tpl ./echt.typ (convert.ps1 direkt): Exit $($direct.Code)`n$($direct.Text)"; $tplOk = $false
}
if (Test-Path -LiteralPath $tplPdf) { Remove-Item -LiteralPath $tplPdf -Force }
# Ordnerform .\eigen\eigen.typ im Notizordner mit einem verlinkten Unterordner (Junction): nur
# die .typ kommt mit (kein Set-Ordner), der Link nie; dazu der Hinweis auf Set-Ordner.
New-Item -ItemType Directory -Force -Path (Join-Path $sbNote 'eigen') | Out-Null
[IO.File]::WriteAllText((Join-Path $sbNote 'eigen\eigen.typ'), "#read(`"daten/canary.txt`")`n", $utf8)
if (New-TestLink 'Junction' (Join-Path $sbNote 'eigen\daten') $geheim) {
  [IO.File]::WriteAllText($tplNote, "---`ntemplate: ./eigen/eigen.typ`n---`n`nText.`n", $utf8)
  Push-Location $sbNote
  $rr = Invoke-Convert @('tpl.md', $tplPdf)
  Pop-Location
  if ($rr.Code -eq 0 -or (Test-Path -LiteralPath $tplPdf) -or $rr.Text -notmatch $notFound) {
    Fail "sandbox tpl ./eigen/eigen.typ: erwartet $notFound`n$($rr.Text)"; $tplOk = $false
  } elseif ($rr.Text -notmatch 'Set-Ordner <name>\\<name>\.typ') {
    Fail "sandbox tpl ./eigen/eigen.typ: Hinweis auf Set-Ordner fehlt`n$($rr.Text)"; $tplOk = $false
  }
}
if ($tplOk) { Ok "sandbox: Vorlage aus der Notiz nur als echte .typ-Datei, allein kopiert ($($tplVals -join ', '), Junction-Unterordner)" }

# Eine einzelne .typ im Vorlagen-Ordner, ueber den Namen gewaehlt (meinset): ihr Ordner kommt
# mit, damit sie Nachbardateien einbinden kann, aber ohne profiles\ (jede Tiefe), ohne
# Punkt-Eintraege, ohne Symlinks, die den Ordner verlassen, und ohne Ordner-Links (Junction).
$mv = Join-Path $sbRoot 'sb-meinset'
New-Item -ItemType Directory -Force -Path (Join-Path $mv 'profiles'), (Join-Path $mv 'x\profiles') | Out-Null
$meinsetTyp = @'
#import "helper.typ": h
#import sys.inputs.mdo + "/lib/markdown.typ": preprocess
#import sys.inputs.mdo + "/vendor/cmarker/lib.typ" as cmarker
#import sys.inputs.mdo + "/vendor/mitex/lib.typ": mitex
#set document(title: h)
#set text(font: ("SourceSans3VF",))
#let a = sys.inputs.at("attach", default: "")
#if a != "" { pdf.attach("/" + a.split("/").last(), read(a, encoding: none), relationship: "source", mime-type: "text/markdown", description: "Markdown source") }
#h

#cmarker.render(preprocess(read(sys.inputs.source)), math: mitex)
'@
[IO.File]::WriteAllText((Join-Path $mv 'meinset.typ'), $meinsetTyp, $utf8)
[IO.File]::WriteAllText((Join-Path $mv 'helper.typ'), "#let h = `"MEINSET-HELPER`"`n", $utf8)
[IO.File]::WriteAllText((Join-Path $mv 'innen.txt'), "INNEN-MARKE`n", $utf8)
[IO.File]::WriteAllText((Join-Path $mv 'profiles\other.yaml'), "OTHER-MARKE`n", $utf8)
[IO.File]::WriteAllText((Join-Path $mv 'x\profiles\y.yaml'), "Y-MARKE`n", $utf8)
[IO.File]::WriteAllText((Join-Path $mv '.hidden.txt'), "DOT-MARKE`n", $utf8)
$innen = 'innen.txt'
if (New-TestLink 'SymbolicLink' (Join-Path $mv 'innen-link.txt') (Join-Path $mv 'innen.txt')) { $innen = 'innen-link.txt' }
$fremd = @('profiles/other.yaml', 'x/profiles/y.yaml', '.hidden.txt')
if (New-TestLink 'SymbolicLink' (Join-Path $mv 'aussen.txt') (Join-Path $geheim 'canary.txt')) { $fremd += 'aussen.txt' }
if (New-TestLink 'Junction' (Join-Path $mv 'ausordner') $geheim) { $fremd += 'ausordner/canary.txt' }
$mvOk = $true
$r = Invoke-Hostile 'meinset' ('$\text{\label{#assert(read("/set/' + $innen + '").contains("INNEN-MARKE"))}}$') '' @('--template', 'meinset') $mv
if (-not $r.Ok) { $mvOk = $false }
elseif (-not (Test-PdfMarker $r.Pdf 'MEINSET-HELPER')) { Fail 'sandbox meinset: Nachbardatei helper.typ nicht eingebunden'; $mvOk = $false }
foreach ($mf in $fremd) {
  $r = Invoke-Hostile 'meinset-fremd' ('$\text{\label{#read("/set/' + $mf + '")}}$') $notFound @('--template', 'meinset') $mv
  if (-not $r.Ok) { $mvOk = $false; continue }
  # Absichtlich ausgelassen: kein Hinweis auf Set-Ordner.
  if ($r.Text -match 'Set-Ordner') { Fail "sandbox meinset ${mf}: falscher Hinweis`n$($r.Text)"; $mvOk = $false }
}
# Ein anderes Set im selben Ordner kennt mdo-pagebreak: meinset bekommt trotzdem die
# raw-typst-Form, der Seitenumbruch bleibt.
New-Item -ItemType Directory -Force -Path (Join-Path $mv 'din5008a') | Out-Null
[IO.File]::WriteAllText((Join-Path $mv 'din5008a\din5008a.typ'), "// html: (mdo-pagebreak: ...)`n", $utf8)
[IO.File]::WriteAllText((Join-Path $sbNote 'mumbruch.md'), "# Eins`n`n<!-- pagebreak -->`n`n# Zwei`n", $utf8)
$savedTpl = $env:MDO_TEMPLATES
$env:MDO_TEMPLATES = $mv
Push-Location $sbNote
$rr = Invoke-Convert @('--template', 'meinset', 'mumbruch.md', (Join-Path $outDir 'sb-mumbruch.pdf'))
Pop-Location
$env:MDO_TEMPLATES = $savedTpl
$pages = Get-PdfPages (Join-Path $outDir 'sb-mumbruch.pdf')
if ($rr.Code -ne 0) { Fail "sandbox meinset umbruch: Exit $($rr.Code)`n$($rr.Text)"; $mvOk = $false }
elseif ($pages -ne 2) { Fail "sandbox meinset umbruch: $pages Seite(n) statt 2 (Nachbar-Set kennt mdo-pagebreak)"; $mvOk = $false }
# Die Vorlage selbst als Symlink aus dem Vorlagen-Ordner heraus (eigenes Repo): wird kopiert.
$repo2 = Join-Path $sbRoot 'sb-repo'
New-Item -ItemType Directory -Force -Path $repo2 | Out-Null
[IO.File]::WriteAllText((Join-Path $repo2 'meinset2.typ'), ($meinsetTyp -replace '#set document\(title: h\)', '#set document(title: "MEINSET2-MARKE")'), $utf8)
Copy-Item -LiteralPath (Join-Path $mv 'helper.typ') -Destination $repo2
if (New-TestLink 'SymbolicLink' (Join-Path $mv 'meinset2.typ') (Join-Path $repo2 'meinset2.typ')) {
  $r = Invoke-Hostile 'meinset2' 'Text.' '' @('--template', 'meinset2') $mv
  if (-not $r.Ok) { $mvOk = $false }
  elseif (-not (Test-PdfMarker $r.Pdf 'MEINSET2-MARKE')) { Fail 'sandbox meinset2: verlinkte Vorlage nicht kopiert'; $mvOk = $false }
}
# Ein Vorlagen-Ordner, der wie das Set heisst (...\meinset mit meinset.typ): kein Set-Ordner (das
# entscheidet der Suchort Vorlagen\<name>\<name>.typ, nicht der Ordnername), also derselbe
# Filter, kein ungefiltertes Kopieren.
$gleich = Join-Path $sbRoot 'sb-gleich\meinset'
New-Item -ItemType Directory -Force -Path (Join-Path $gleich 'x\profiles') | Out-Null
Copy-Item -LiteralPath (Join-Path $mv 'meinset.typ'), (Join-Path $mv 'helper.typ') -Destination $gleich
[IO.File]::WriteAllText((Join-Path $gleich '.hidden.txt'), "DOT-MARKE`n", $utf8)
[IO.File]::WriteAllText((Join-Path $gleich 'x\profiles\y.yaml'), "Y-MARKE`n", $utf8)
$r = Invoke-Hostile 'gleich' 'Text.' '' @('--template', 'meinset') $gleich
if (-not $r.Ok) { $mvOk = $false }
foreach ($mf in @('.hidden.txt', 'x/profiles/y.yaml')) {
  $r = Invoke-Hostile 'gleich-fremd' ('$\text{\label{#read("/set/' + $mf + '")}}$') $notFound @('--template', 'meinset') $gleich
  if (-not $r.Ok) { $mvOk = $false }
}
if ($mvOk) { Ok "sandbox: einzelne .typ ueber den Namen: Nachbardateien ja; $($fremd -join ', ') nein (auch im gleichnamigen Vorlagen-Ordner)" }

# Jede Schreibweise von profiles und .git bleibt draussen (spiegelt test-pdf.sh): Windows
# unterscheidet sie im Dateisystem nicht, die Profilsuche des Wrappers findet Profiles\ als
# profiles\. Einzelne .typ ueber den Namen (meinset) wie Set-Ordner (fset).
$gross = Join-Path $sbRoot 'sb-gross'
New-Item -ItemType Directory -Force -Path (Join-Path $gross 'Profiles'), (Join-Path $gross 'x\PROFILES'),
  (Join-Path $gross 'fset\Profiles'), (Join-Path $gross 'fset\.GIT') | Out-Null
Copy-Item -LiteralPath (Join-Path $mv 'meinset.typ'), (Join-Path $mv 'helper.typ') -Destination $gross
Copy-Item -LiteralPath (Join-Path $mv 'meinset.typ') -Destination (Join-Path $gross 'fset\fset.typ')
Copy-Item -LiteralPath (Join-Path $mv 'helper.typ') -Destination (Join-Path $gross 'fset')
[IO.File]::WriteAllText((Join-Path $gross 'Profiles\other.yaml'), "OTHER-MARKE`n", $utf8)
[IO.File]::WriteAllText((Join-Path $gross 'x\PROFILES\y.yaml'), "Y-MARKE`n", $utf8)
[IO.File]::WriteAllText((Join-Path $gross 'fset\Profiles\other.yaml'), "OTHER-MARKE`n", $utf8)
[IO.File]::WriteAllText((Join-Path $gross 'fset\.GIT\config'), "GIT-MARKE`n", $utf8)
$grossOk = $true
foreach ($t in @('meinset', 'fset')) {
  if (-not (Invoke-Hostile "gross-$t" 'Text.' '' @('--template', $t) $gross).Ok) { $grossOk = $false }
}
foreach ($mf in @('Profiles/other.yaml', 'x/PROFILES/y.yaml', 'fset/Profiles/other.yaml')) {
  $r = Invoke-Hostile 'gross-fremd' ('$\text{\label{#read("/set/' + $mf + '")}}$') $notFound @('--template', 'meinset') $gross
  if (-not $r.Ok) { $grossOk = $false }
}
foreach ($mf in @('Profiles/other.yaml', '.GIT/config')) {
  $r = Invoke-Hostile 'gross-fremd' ('$\text{\label{#read("/set/' + $mf + '")}}$') $notFound @('--template', 'fset') $gross
  if (-not $r.Ok) { $grossOk = $false }
}
if ($grossOk) { Ok 'sandbox: Profiles\, PROFILES\ und .GIT\ bleiben draussen wie profiles\ und .git\' }

# Eine Vorlage als UNC-Pfad aus der Notiz: sofort "Vorlage nicht gefunden", ohne den Server zu
# fragen (kein Haengen, kein SMB-Kontakt, der den NTLM-Hash preisgaebe).
[IO.File]::WriteAllText((Join-Path $sbNote 'unc.md'), "---`ntemplate: //nonexistent.invalid/x.typ`n---`n`nText.`n", $utf8)
$watch = [Diagnostics.Stopwatch]::StartNew()
Push-Location $sbNote
$rr = Invoke-Convert @('unc.md', (Join-Path $outDir 'sb-unc.pdf'))
Pop-Location
$watch.Stop()
if ($rr.Code -ne 1 -or $rr.Text -notmatch 'Vorlage nicht gefunden: //nonexistent\.invalid/x\.typ') {
  Fail "sandbox UNC-Vorlage: Exit $($rr.Code)`n$($rr.Text)"
} elseif ($watch.Elapsed.TotalSeconds -gt 30) {
  Fail "sandbox UNC-Vorlage: $([int]$watch.Elapsed.TotalSeconds) s (Server gefragt?)"
} else { Ok "sandbox: UNC-Vorlage aus der Notiz sofort abgelehnt ($([int]$watch.Elapsed.TotalSeconds) s)" }

# Bilder nur aus dem Notizordner und seinen Unterordnern (spiegelt test-pdf.sh): ein sichtbar
# verlinktes Bild ausserhalb fehlt im PDF (mit Hinweis), eines im Unterordner erscheint.
Copy-Item -LiteralPath (Join-Path $Fixtures 'bilder\screenshot.png') -Destination (Join-Path $sb 'bilder\aussen.png')
[IO.File]::WriteAllText((Join-Path $sbNote 'aussen.md'), "# Aussen`n`n![](../bilder/aussen.png)`n`nENDE.`n", $utf8)
$null = New-Item -ItemType Directory -Force -Path (Join-Path $sbNote 'innen')
Copy-Item -LiteralPath (Join-Path $Fixtures 'bilder\screenshot.png') -Destination (Join-Path $sbNote 'innen\bild.png')
[IO.File]::WriteAllText((Join-Path $sbNote 'innen.md'), "# Innen`n`n![](innen/bild.png)`n`nENDE.`n", $utf8)
Push-Location $sbNote
$rr = Invoke-Convert @('aussen.md', (Join-Path $outDir 'sb-aussen.pdf'))
$ri = Invoke-Convert @('innen.md', (Join-Path $outDir 'sb-innen.pdf'))
Pop-Location
if ($rr.Code -ne 0) { Fail "sandbox aussen: Exit $($rr.Code)`n$($rr.Text)" }
elseif ($rr.Text -notmatch 'Bild liegt au.erhalb des Notizordners, kommt nicht ins PDF: \.\./bilder/aussen\.png') {
  Fail "sandbox aussen: kein Hinweis`n$($rr.Text)"
}
elseif ((Get-PdfRaw (Join-Path $outDir 'sb-aussen.pdf')) -match '/Subtype\s*/Image') { Fail 'sandbox aussen: Bild von ausserhalb im PDF' }
elseif ($ri.Code -ne 0) { Fail "sandbox innen: Exit $($ri.Code)`n$($ri.Text)" }
elseif ($ri.Text -match 'nicht gefunden') { Fail "sandbox innen: Bild nicht gefunden`n$($ri.Text)" }
elseif ((Get-PdfRaw (Join-Path $outDir 'sb-innen.pdf')) -notmatch '/Subtype\s*/Image') { Fail 'sandbox innen: Bild fehlt im PDF' }
else { Ok 'sandbox: Bild ausserhalb des Notizordners bleibt draussen, Bild im Unterordner erscheint' }

# Seitenumbruch alter Form: ein Set ohne mdo-pagebreak (probe, raw-typst an) bricht weiter um.
[IO.File]::WriteAllText((Join-Path $sbNote 'umbruch.md'), "# Eins`n`n\newpage`n`n# Zwei`n", $utf8)
$env:MDO_TEMPLATES = $fixtureTemplates
Push-Location $sbNote
$rr = Invoke-Convert @('--template', 'probe', 'umbruch.md', (Join-Path $outDir 'sb-umbruch.pdf'))
Pop-Location
$env:MDO_TEMPLATES = $EmptyTemplates
$pages = Get-PdfPages (Join-Path $outDir 'sb-umbruch.pdf')
if ($rr.Code -ne 0) { Fail "sandbox umbruch: Exit $($rr.Code)`n$($rr.Text)" }
elseif ($pages -ne 2) { Fail "sandbox umbruch: $pages Seite(n) statt 2 (Set ohne mdo-pagebreak)" }
else { Ok 'sandbox: Seitenumbruch fuer ein Set ohne mdo-pagebreak (raw-typst-Form)' }

# convert.ps1 allein (ohne Manifest des Wrappers) exportiert nicht.
Push-Location $sbNote
$rr = Invoke-ConvertDirect @('aussen.md', (Join-Path $outDir 'sb-direkt.pdf')) ''
Pop-Location
if ($rr.Code -ne 1) { Fail "convert.ps1 ohne Manifest: Exit $($rr.Code)`n$($rr.Text)" }
elseif ($rr.Text -notmatch 'markdown-office') { Fail "convert.ps1 ohne Manifest: unklare Meldung`n$($rr.Text)" }
elseif (Test-Path -LiteralPath (Join-Path $outDir 'sb-direkt.pdf')) { Fail 'convert.ps1 ohne Manifest erzeugt ein PDF' }
else { Ok 'convert.ps1 ohne MDO_MANIFEST: Exit 1 mit Hinweis auf markdown-office' }

# Das Manifest einer anderen Notiz exportiert nicht (spiegelt test-pdf.sh); das der Notiz selbst
# in anderer Schreibweise (Gross-/Kleinschreibung) schon.
$mOk = $true
Push-Location $sbNote
$rr = Invoke-ConvertDirect @('aussen.md', (Join-Path $outDir 'sb-fremdmanifest.pdf')) (New-TestManifest (Join-Path $sbNote 'umbruch.md'))
$own = Invoke-ConvertDirect @('aussen.md', (Join-Path $outDir 'sb-eigenmanifest.pdf')) (New-TestManifest (Join-Path $sbNote 'AUSSEN.md'))
Pop-Location
if ($rr.Code -ne 1 -or $rr.Text -notmatch 'Export-Manifest gehoert zu einer anderen Notiz') {
  Fail "convert.ps1 mit fremdem Manifest: Exit $($rr.Code)`n$($rr.Text)"; $mOk = $false
} elseif (Test-Path -LiteralPath (Join-Path $outDir 'sb-fremdmanifest.pdf')) { Fail 'convert.ps1 mit fremdem Manifest erzeugt ein PDF'; $mOk = $false }
if ($own.Code -ne 0) { Fail "convert.ps1 mit eigenem Manifest: Exit $($own.Code)`n$($own.Text)"; $mOk = $false }
if ($mOk) { Ok 'convert.ps1: Manifest einer anderen Notiz abgewiesen, das eigene angenommen' }

# din5008a: Profil in einem gemeinsamen profiles\-Ordner neben einem anderen Profil. Nur das
# eigene Profil und die Unterschrift, die es nennt, liegen im Staging-Ordner (/profile/...).
$dinSet = Join-Path $env:MDO_SETS_DIR 'din5008a'
if (Test-Path -LiteralPath (Join-Path $dinSet 'din5008a.typ') -PathType Leaf) {
  $user = Join-Path $sb 'user'
  New-Item -ItemType Directory -Force -Path (Join-Path $user 'profiles') | Out-Null
  $kanzlei = "# KANZLEI-MARKE`n" + [IO.File]::ReadAllText((Join-Path $Fixtures 'profiles\din-ohne-qr.yaml')).TrimEnd() + "`nsignature: kanzlei-sig.svg`n"
  [IO.File]::WriteAllText((Join-Path $user 'profiles\kanzlei.yaml'), $kanzlei, $utf8)
  Copy-Item -LiteralPath (Join-Path $Fixtures 'profiles\din-unterschrift.svg') -Destination (Join-Path $user 'profiles\kanzlei-sig.svg')
  [IO.File]::WriteAllText((Join-Path $user 'profiles\other.yaml'), "# OTHER-MARKE`nname: Other`nsignature: other-sig.svg`n", $utf8)
  [IO.File]::WriteAllText((Join-Path $user 'profiles\other-sig.svg'), "<svg xmlns=`"http://www.w3.org/2000/svg`" viewBox=`"0 0 10 10`"><text>OTHER-SIG</text></svg>`n", $utf8)
  # Brief mit der Zeile exportieren; $Templates ist der Vorlagen-Ordner.
  function Invoke-DinNote([string]$Name, [string]$Line, [string]$Templates) {
    $pdf = Join-Path $outDir "sb-$Name.pdf"
    if (Test-Path -LiteralPath $pdf) { Remove-Item -LiteralPath $pdf -Force }
    [IO.File]::WriteAllText((Join-Path $user "$Name.md"), "---`ntemplate: din5008a`nprofile: kanzlei`nx-to:`n  - Empfaenger`n---`n`nText $Line`n", $utf8)
    $savedTpl = $env:MDO_TEMPLATES
    $env:MDO_TEMPLATES = $Templates
    Push-Location $user
    $res = Invoke-Convert @("$Name.md", $pdf)
    Pop-Location
    $env:MDO_TEMPLATES = $savedTpl
    $res.Pdf = $pdf
    return $res
  }
  $ownRead = '$\text{\label{#assert(read("/profile/kanzlei.yaml").contains("KANZLEI-MARKE"))}}$'
  $dinOk = $true
  # Gegenprobe: das eigene Profil liegt unter /profile/ und ist lesbar.
  $rr = Invoke-DinNote 'eigen' $ownRead $EmptyTemplates
  if ($rr.Code -ne 0 -or -not (Test-PdfA $rr.Pdf)) { Fail "sandbox din5008a eigen: Exit $($rr.Code)`n$($rr.Text)"; $dinOk = $false }
  foreach ($f in @('/profile/other.yaml', '/profile/other-sig.svg')) {
    $rr = Invoke-DinNote 'fremd' ('$\text{\label{#read("' + $f + '")}}$') $EmptyTemplates
    if ($rr.Code -eq 0 -or (Test-Path -LiteralPath $rr.Pdf) -or $rr.Text -notmatch $notFound) {
      Fail "sandbox din5008a fremd ${f}: lesbar oder falscher Fehler`n$($rr.Text)"; $dinOk = $false
    }
  }
  if ($dinOk) { Ok 'sandbox din5008a: nur das eigene Profil und seine Unterschrift aus profiles\' }

  # Das Set als Ordner im Vorlagen-Ordner (Vorlagen\din5008a\profiles haelt die Profile aller
  # Absender): profiles\ des Sets kommt nicht in den Staging-Ordner, nur das eigene Profil.
  $vset = Join-Path $sbRoot 'sb-vorlagen-set'
  New-Item -ItemType Directory -Force -Path $vset | Out-Null
  Copy-Item -LiteralPath $dinSet -Destination (Join-Path $vset 'din5008a') -Recurse -Force
  $vgit = Join-Path $vset 'din5008a\.git'
  if (Test-Path -LiteralPath $vgit) { Remove-Item -LiteralPath $vgit -Recurse -Force }
  New-Item -ItemType Directory -Force -Path (Join-Path $vset 'din5008a\profiles') | Out-Null
  Copy-Item -LiteralPath (Join-Path $user 'profiles\kanzlei.yaml'), (Join-Path $user 'profiles\kanzlei-sig.svg'),
    (Join-Path $user 'profiles\other.yaml'), (Join-Path $user 'profiles\other-sig.svg') -Destination (Join-Path $vset 'din5008a\profiles')
  Remove-Item -LiteralPath (Join-Path $user 'profiles') -Recurse -Force
  $dinOk = $true
  $rr = Invoke-DinNote 'eigen' $ownRead $vset
  if ($rr.Code -ne 0 -or -not (Test-PdfA $rr.Pdf)) { Fail "sandbox din5008a im Set-Ordner: Exit $($rr.Code)`n$($rr.Text)"; $dinOk = $false }
  foreach ($f in @('/set/profiles/other.yaml', '/set/profiles/kanzlei.yaml', '/profile/other.yaml')) {
    $rr = Invoke-DinNote 'fremd' ('$\text{\label{#read("' + $f + '")}}$') $vset
    if ($rr.Code -eq 0 -or (Test-Path -LiteralPath $rr.Pdf) -or $rr.Text -notmatch $notFound) {
      Fail "sandbox din5008a im Set-Ordner, fremd ${f}: lesbar oder falscher Fehler`n$($rr.Text)"; $dinOk = $false
    }
  }
  if ($dinOk) { Ok 'sandbox din5008a: Profile im Set-Ordner (Vorlagen\din5008a\profiles) bleiben draussen' }

  # Das Set als Junction im Vorlagen-Ordner (eigener Klon): sein Profil wird gefunden.
  $vlink = Join-Path $sbRoot 'sb-vorlagen-link'
  New-Item -ItemType Directory -Force -Path $vlink | Out-Null
  if (New-TestLink 'Junction' (Join-Path $vlink 'din5008a') (Join-Path $vset 'din5008a')) {
    $rr = Invoke-DinNote 'link' 'Text.' $vlink
    if ($rr.Code -ne 0 -or -not (Test-PdfA $rr.Pdf)) { Fail "sandbox din5008a verlinkt: Exit $($rr.Code)`n$($rr.Text)" }
    else { Ok 'sandbox din5008a: Profil im verlinkten Set-Ordner (Junction)' }
  }
} else {
  Skip "sandbox din5008a (kein Set din5008a in $env:MDO_SETS_DIR)"
}

# Kein Staging-Ordner bleibt zurueck, weder nach Erfolg noch nach gescheitertem Export.
$stagesLeft = @(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter 'mdo-stage-*' -Force -ErrorAction SilentlyContinue |
  Where-Object { $StagesBefore -notcontains $_.FullName })
if ($stagesLeft.Count -gt 0) { Fail "Staging-Ordner zurueckgeblieben: $(($stagesLeft | ForEach-Object { $_.FullName }) -join ', ')" }
else { Ok 'sandbox: keine mdo-stage-* nach Erfolg und Fehlschlag' }

Set-Location $Repo
Remove-Item -LiteralPath $EmptyTemplates -Recurse -Force -ErrorAction SilentlyContinue

if ($failed -gt 0) { Write-Host "$failed Test(s) fehlgeschlagen." -ForegroundColor Red; exit 1 }
Write-Host 'Alle Windows-Tests bestanden.' -ForegroundColor Green
