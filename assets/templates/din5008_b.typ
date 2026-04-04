// DIN 5008 Form B Geschaeftsbrief-Template
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
#let sender_phone   = sys.inputs.at("sender_phone",   default: "")
#let sender_email   = sys.inputs.at("sender_email",   default: "")
#let recipient_extra = sys.inputs.at("recipient_extra", default: "")
#let closing        = sys.inputs.at("closing",        default: "Mit freundlichen Grüßen")
#let body_text      = sys.inputs.at("body",           default: "")
#let attachments    = sys.inputs.at("attachments",    default: "")

// ── Hilfswerte ────────────────────────────────────────────────────────────────
#let gray       = rgb("#808080")
#let bullet_sep = "▪"

// DIN 5008 Form B – Masse in mm
#let margin_left   = 25mm
#let margin_right  = 20mm
#let margin_top    = 20mm
#let margin_bottom = 20mm

#let y_letterhead      = 45mm
#let y_return_address  = 62.6mm
#let y_recipient       = 63.6mm
#let y_body            = 103.6mm
#let y_fold1           = 105mm
#let y_hole_mark       = 148.5mm
#let y_fold2           = 210mm

// Sender-Block: rechtsbuendig, 55mm breit
#let sender_block_width = 55mm

// ── Seiteneinrichtung ─────────────────────────────────────────────────────────
#set page(
  paper: "a4",
  margin: (left: margin_left, right: margin_right, top: margin_top, bottom: margin_bottom),
)

// ── Typografie ────────────────────────────────────────────────────────────────
#set text(
  font: "Source Serif 4",
  size: 11pt,
  lang: "de",
)
#set par(leading: 11pt * 0.15)   // Zeilenabstand 1.15 × 11pt → Abstand = 0.15 × 11pt

// ── Falzmarken und Lochmarke (absolut positioniert) ───────────────────────────
#place(
  top + left,
  dx: -margin_left,
  dy: y_fold1 - margin_top,
  line(length: 8mm, stroke: 0.5pt + gray),
)

#place(
  top + left,
  dx: -margin_left,
  dy: y_hole_mark - margin_top,
  line(length: 6mm, stroke: 1pt + gray),
)

#place(
  top + left,
  dx: -margin_left,
  dy: y_fold2 - margin_top,
  line(length: 8mm, stroke: 0.5pt + gray),
)

// ── Briefkopf – Absenderblock (rechts, ab y_letterhead) ──────────────────────
#place(
  top + right,
  dy: y_letterhead - margin_top,
  block(
    width: sender_block_width,
    align(right)[
      #text(font: "Source Sans 3", weight: "bold")[#sender_name] \
      #text(font: "Source Sans 3")[#sender_street] \
      #text(font: "Source Sans 3")[#sender_zip #sender_city] \
      #if sender_phone != "" [
        #text(font: "Source Sans 3")[#sender_phone] \
      ]
      #if sender_email != "" [
        #text(font: "Source Sans 3")[#sender_email]
      ]
    ],
  ),
)

// ── Ruecksendezeile (Absender in einer Zeile, unterstrichen) ──────────────────
#place(
  top + left,
  dy: y_return_address - margin_top,
  block(
    width: 85mm,
    text(
      font: "Source Sans 3",
      size: 8pt,
      fill: gray,
      underline[#sender_name #bullet_sep #sender_street #bullet_sep #sender_zip #sender_city],
    ),
  ),
)

// ── Empfaengeradresse ─────────────────────────────────────────────────────────
#place(
  top + left,
  dy: y_recipient - margin_top,
  block(
    width: 85mm,
    [
      #recipient_name \
      #if recipient_extra != "" [#recipient_extra \ ]
      #recipient_street \
      #recipient_zip #recipient_city
    ],
  ),
)

// ── Hauptinhalt (beginnt bei y_body) ─────────────────────────────────────────
// Oberer Abstand vom Seitenrand bis Textkoerper-Startposition
#v(y_body - margin_top)

// Datum rechtsbuendig
#align(right)[
  #text(font: "Source Sans 3")[#date]
]

#v(11pt)  // eine Leerzeile

// Betreff fett
#text(weight: "bold")[#subject]

#v(11pt)  // eine Leerzeile nach Betreff (DIN 5008: keine Leerzeile vor Ueberschriften)

// Brieftext
#body_text

#v(11pt)  // Leerzeile vor Schlussformel

// Schlussformel
#closing

// 3 Leerzeilen fuer Unterschrift
#v(3 * 11pt * 1.15)

// Name des Absenders
#sender_name

// ── Anlagen ───────────────────────────────────────────────────────────────────
#if attachments != "" [
  #v(11pt)
  #text(weight: "bold")[Anlagen]
  #v(4pt)
  #for item in attachments.split("\n") [
    #if item.trim() != "" [
      #bullet_sep #item.trim() \
    ]
  ]
]

// ── Fusszeile ─────────────────────────────────────────────────────────────────
#place(
  bottom + center,
  dy: margin_bottom,
  block(
    width: 100% - margin_left - margin_right,
    align(center)[
      #line(length: 100%, stroke: 0.5pt + gray)
      #v(3pt)
      #text(font: "Source Sans 3", size: 8pt, fill: gray)[
        #if sender_phone != "" [#sender_phone]
        #if sender_phone != "" and sender_email != "" [ #bullet_sep ]
        #if sender_email != "" [#sender_email]
      ]
      #v(2pt)
      #text(font: "Source Sans 3", size: 8pt, fill: gray)[
        #counter(page).display("1 / 1", both: true)
      ]
    ],
  ),
)
