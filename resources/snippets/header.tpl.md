---
template: memo          # Vorlagen-Set
title: "${1:Titel}"         # Titelblock, Kopfzeile, PDF-Titel
subtitle: "$2"           # unter dem Titel
client: "$3"             # klein über dem Titel
author: "$4"             # „Datum · Autor“; mehrere: [Anna, Ben]
date: ${5:$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE}       # leer: kein Datum
isodate_praefix: ${6:true}  # ISO-Datum vor dem Dateinamen
lang: ${7:de}               # de oder en
toc: ${8:auto}              # Inhaltsverzeichnis: auto, true, false
h1_break: ${9:auto}         # Kapitel auf neuer Seite: auto = wie toc
header: "$10"             # fester Kopfzeilentext
print_filename: ${11:true}   # Angabe links in der Fußzeile
watermark: "$12"          # z. B. ENTWURF
logo: "$13"               # Logo nur für dieses Dokument
logo-height: ${14:13mm}      # maximale Logohöhe, bis 25mm
embed_source: ${15:true}     # Markdown-Quelle ins PDF einbetten
hard_breaks: ${16:true}      # jede Zeile bleibt eine Zeile
---

$0
