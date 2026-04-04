// Elegant Korrespondenz-Template
// Alle variablen Daten werden ueber sys.inputs uebergeben.

// ── Eingaben lesen ────────────────────────────────────────────────────────────
// Pflichtfelder (kein Default)
#let sender_name    = sys.inputs.at("sender_name")
#let sender_street  = sys.inputs.at("sender_street")
#let sender_zip     = sys.inputs.at("sender_zip")
#let sender_city    = sys.inputs.at("sender_city")
#let recipient_name = sys.inputs.at("recipient_name")
#let recipient_street = sys.inputs.at("recipient_street")
#let recipient_zip  = sys.inputs.at("recipient_zip")
#let recipient_city = sys.inputs.at("recipient_city")
#let subject        = sys.inputs.at("subject")
#let date           = sys.inputs.at("date")

// Optionale Felder (mit Default)
#let sender_phone    = sys.inputs.at("sender_phone",    default: "")
#let sender_email    = sys.inputs.at("sender_email",    default: "")
#let recipient_extra = sys.inputs.at("recipient_extra", default: "")
#let reference       = sys.inputs.at("reference",       default: "")
#let closing         = sys.inputs.at("closing",         default: "Mit freundlichen Grüßen")
#let cc              = sys.inputs.at("cc",              default: "")
#let body_text       = sys.inputs.at("body",            default: "")
#let attachments     = sys.inputs.at("attachments",     default: "")

// ── Hilfswerte ────────────────────────────────────────────────────────────────
#let burgundy   = rgb("#6B1D2A")
#let cream      = rgb("#FAF8F1")
#let gray       = rgb("#808080")

// ── Seiteneinrichtung ─────────────────────────────────────────────────────────
#set page(
  paper: "a4",
  margin: (left: 25mm, right: 20mm, top: 20mm, bottom: 20mm),
  fill: cream,
  header: context {
    // Header auf allen Seiten wiederholen
    block(
      width: 100%,
      [
        #align(center)[
          #text(
            font: "Source Sans 3",
            size: 14pt,
            weight: "bold",
            fill: burgundy,
            smallcaps(sender_name),
          )
        ]
        #v(2pt)
        #align(center)[
          #text(font: "Source Sans 3", size: 9pt, fill: gray)[
            #sender_street #sym.bullet #sender_zip #sender_city
          ]
        ]
        #if sender_phone != "" or sender_email != "" [
          #v(1pt)
          #align(center)[
            #text(font: "Source Sans 3", size: 9pt, fill: gray)[
              #if sender_phone != "" [#sender_phone]
              #if sender_phone != "" and sender_email != "" [ #sym.bullet ]
              #if sender_email != "" [#sender_email]
            ]
          ]
        ]
        #v(4pt)
        #line(length: 100%, stroke: 0.5pt + gray)
        #v(2pt)
      ],
    )
  },
  footer: context {
    align(right)[
      #text(font: "Source Sans 3", size: 8pt, fill: gray)[
        Seite #counter(page).display() von #counter(page).final().first()
      ]
    ]
  },
)

// ── Typografie ────────────────────────────────────────────────────────────────
#set text(
  font: "Source Serif 4",
  size: 11pt,
  lang: "de",
)
#set par(
  leading: 11pt * 0.15,
  first-line-indent: 5mm,
)

// ── Falzmarken (linker Rand, grau) ────────────────────────────────────────────
// Falzmarke 1 bei 105mm, Falzmarke 2 bei 210mm, Lochmarke bei 148.5mm
// dy relativ zum Seitenanfang (inkl. Header-Bereich)
#place(
  top + left,
  dx: -25mm,
  dy: 105mm - 20mm,
  line(length: 8mm, stroke: 0.5pt + gray),
)

#place(
  top + left,
  dx: -25mm,
  dy: 148.5mm - 20mm,
  line(length: 6mm, stroke: 1pt + gray),
)

#place(
  top + left,
  dx: -25mm,
  dy: 210mm - 20mm,
  line(length: 8mm, stroke: 0.5pt + gray),
)

// ── Ruecksendezeile ───────────────────────────────────────────────────────────
#text(
  font: "Source Sans 3",
  size: 8pt,
  fill: gray,
  underline[#sender_name #sym.bullet #sender_street #sym.bullet #sender_zip #sender_city],
)

#v(2pt)

// ── Empfaengeradresse ─────────────────────────────────────────────────────────
#block(
  width: 85mm,
  [
    #set par(first-line-indent: 0mm)
    #recipient_name \
    #if recipient_extra != "" [#recipient_extra \ ]
    #recipient_street \
    #recipient_zip #recipient_city
  ],
)

#v(10mm)

// ── Referenz und Datum (zweispaltig) ──────────────────────────────────────────
#grid(
  columns: (1fr, auto),
  gutter: 4mm,
  [
    #if reference != "" [
      #text(font: "Source Sans 3", size: 9pt, fill: gray)[Referenz:] \
      #text(font: "Source Sans 3", size: 9pt)[#reference]
    ]
  ],
  [
    #text(font: "Source Sans 3", size: 9pt)[#date]
  ],
)

#v(6mm)

// ── Betreff ───────────────────────────────────────────────────────────────────
#text(weight: "bold")[#subject]

#v(11pt)  // eine Leerzeile nach Betreff

// ── Brieftext ─────────────────────────────────────────────────────────────────
#body_text

#v(11pt)

// ── Schlussformel ─────────────────────────────────────────────────────────────
#set par(first-line-indent: 0mm)
#closing

// 3 Leerzeilen fuer Unterschrift
#v(3 * 11pt * 1.15)

// Name des Absenders
#sender_name

// ── CC ────────────────────────────────────────────────────────────────────────
#if cc != "" [
  #v(8pt)
  #text(font: "Source Sans 3", size: 9pt)[
    #text(style: "italic")[In Kopie:] #cc
  ]
]

// ── Anlagen ───────────────────────────────────────────────────────────────────
#if attachments != "" [
  #v(11pt)
  #text(font: "Source Sans 3", size: 10pt, style: "italic")[Anhänge:]
  #v(3pt)
  #for item in attachments.split("\n") [
    #if item.trim() != "" [
      #set par(first-line-indent: 0mm)
      #sym.bullet.filled #item.trim() \
    ]
  ]
]
