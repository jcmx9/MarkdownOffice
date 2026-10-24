// Markdown-Vorverarbeitung VOR cmarker – reine String-Arbeit in Typst.
//
// Warum in Typst und nicht in build.sh (awk) / convert.ps1: so existiert jede
// Umformung genau EINMAL und gilt auf macOS, Linux und Windows identisch. Die
// Shell-Skripte parsen nur noch das Frontmatter und kümmern sich um Dateipfade.
//
// Alle Funktionen arbeiten zeilenweise und lassen Code-Blöcke (``` / ~~~)
// unangetastet (siehe code-mask).

#let blank(s) = s.trim() == ""

// Zeilen, die zu einem umzäunten Code-Block gehören (inkl. der Zaunzeilen).
// Ein Zaun ist ``` oder ~~~ (mind. 3, bis 3 Leerzeichen eingerückt); er endet
// an einem Zaun derselben Art, der mindestens so lang ist.
// Ebenso maskiert: mehrzeilige HTML-Kommentare (<!-- … --> über mehrere Zeilen),
// sonst macht etwa die Typografie aus dem schließenden "-->" ein "–>" und der
// Kommentar verschluckt den Rest. Einzeilige Kommentare bleiben unmaskiert
// (pagebreaks erkennt sie).
#let code-mask(lines) = {
  let mask = ()
  let fence = none
  let comment = false
  for l in lines {
    if comment {
      mask.push(true)
      if l.contains("-->") { comment = false }
      continue
    }
    let m = l.match(regex("^ {0,3}(`{3,}|~{3,})"))
    if fence == none {
      if m != none {
        fence = m.captures.at(0)
        mask.push(true)
      } else {
        // Ein Kommentar, der am Zeilenende noch offen ist (Inline-Code zählt nicht).
        let t = l.replace(regex("`[^`]*`"), "")
        comment = t.contains("<!--") and not t.split("<!--").last().contains("-->")
        mask.push(comment)
      }
    } else {
      mask.push(true)
      let t = l.trim()
      if (m != none and m.captures.at(0).first() == fence.first()
          and m.captures.at(0).len() >= fence.len() and t.trim(fence.first()) == "") {
        fence = none
      }
    }
  }
  mask
}

// Führendes YAML-Frontmatter (--- … --- bzw. …) entfernen; CRLF -> LF.
#let strip-frontmatter(src) = {
  let lines = src.replace("\r\n", "\n").replace("\r", "\n").split("\n")
  if lines.len() > 0 and lines.first().trim(at: end) == "---" {
    for (i, l) in lines.enumerate() {
      if i > 0 and (l.trim(at: end) == "---" or l.trim(at: end) == "...") {
        return lines.slice(i + 1)
      }
    }
  }
  lines
}

// Front matter as Typst data for template sets: the whole leading YAML block, parsed with
// Typst's own yaml() (lists, maps, typed values). Why: the shell parsers in build.sh and
// convert.ps1 only read flat pipeline keys; set-specific keys (x-…) and structured values
// such as an address list reach the set this way, identically on every OS.
// No front matter, an empty block or an unclosed block -> (:).
#let frontmatter(src) = {
  let lines = src.replace("\r\n", "\n").replace("\r", "\n").split("\n")
  if lines.len() == 0 or lines.first().trim(at: end) != "---" { return (:) }
  for (i, l) in lines.enumerate() {
    if i > 0 and (l.trim(at: end) == "---" or l.trim(at: end) == "...") {
      let block = lines.slice(1, i).join("\n")
      if block.trim() == "" { return (:) }
      let data = yaml(bytes(block))
      return if type(data) == dictionary { data } else { (:) }
    }
  }
  (:)
}

// Pandoc-Definitionslisten (Begriff + Folgezeile ": Definition") in HTML <dl>
// übersetzen – cmarker kennt nur <dl>. Block-Form (Leerzeile nach <dd>), damit
// Inline-Markdown in der Definition rendert. Eingerückte Fortsetzungszeilen der
// Definition werden angehängt (sonst landen sie als Fließtext am linken Rand).
#let deflists(lines) = {
  let mask = code-mask(lines)
  let is-def(s) = s.match(regex("^:[ \t]+")) != none
  let n = lines.len()
  let out = ()
  let i = 0
  while i < n {
    let l = lines.at(i)
    if (not mask.at(i) and not blank(l) and not l.starts-with(":")
        and (i == 0 or blank(lines.at(i - 1)))
        and i + 1 < n and is-def(lines.at(i + 1))) {
      out.push("<dl>")
      while true {
        if (i + 1 >= n or blank(lines.at(i)) or lines.at(i).starts-with(":")
            or not is-def(lines.at(i + 1))) { break }
        let term = lines.at(i)
        let def = lines.at(i + 1).replace(regex("^:[ \t]+"), "")
        let k = i + 2
        while (k < n and not blank(lines.at(k)) and lines.at(k).match(regex("^[ \t]+")) != none
               and lines.at(k).match(regex("^[ \t]*:[ \t]+")) == none) {
          def += " " + lines.at(k).trim(at: start)
          k += 1
        }
        out += ("<dt>" + term + "</dt>", "<dd>", "", def, "</dd>")
        i = k
        let j = i
        while j < n and blank(lines.at(j)) { j += 1 }
        if j + 1 < n and not lines.at(j).starts-with(":") and is-def(lines.at(j + 1)) { i = j }
      }
      out.push("</dl>")
      continue
    }
    out.push(l)
    i += 1
  }
  out
}

// Code-Blöcke UND abgesetzte Formeln ($$ … $$ über mehrere Zeilen): dort darf
// keine Umformung greifen (kein \ für harte Umbrüche, kein <mark>).
#let skip-mask(lines) = {
  let mask = code-mask(lines)
  let in-math = false
  for (i, l) in lines.enumerate() {
    if mask.at(i) { continue }
    let t = l.trim()
    if in-math {
      mask.at(i) = true
      if t.ends-with("$$") { in-math = false }
    } else if t.starts-with("$$") {
      mask.at(i) = true
      // "$$ x $$" in einer Zeile schließt sofort wieder
      if t == "$$" or not t.slice(2).trim().ends-with("$$") { in-math = true }
    }
  }
  mask
}

// Seitenumbruch: "<!-- pagebreak -->", "\newpage", "\pagebreak" oder
// "\clearpage" allein auf einer Zeile -> Typst-Umbruch. Leerzeilen drumherum
// machen ihn zum eigenen Block, auch wenn in der Notiz keine stehen.
// Form nach Eingabe pagebreak: "html" -> das Element mdo-pagebreak, das das Set
// über seine html:-Zuordnung setzt (Sets mit raw-typst: false, in denen Notiztext
// nie als Typst-Code läuft; build.sh/convert.ps1 senden "html" nur an Sets, deren
// .typ mdo-pagebreak nennt). Ausdrücklich geschlossen: cmarker liest ein nicht als
// "void" erklärtes Element wie HTML, ein <mdo-pagebreak/> öffnete es nur und der
// Rest der Notiz würde sein (verworfener) Inhalt; mit Schluss-Tag gilt das für
// beide Erklärungsarten. Sonst (ältere und eigene Sets) wie bisher
// <!--raw-typst …-->, das cmarker als Typst-Code ausführt – kein Set verliert so
// still seine Seitenumbrüche.
#let pagebreak-line = if sys.inputs.at("pagebreak", default: "raw") == "html" {
  "<mdo-pagebreak></mdo-pagebreak>"
} else {
  "<!--raw-typst #pagebreak(weak: true) -->"
}
#let pagebreaks(lines) = {
  let mask = code-mask(lines)
  let out = ()
  for (i, l) in lines.enumerate() {
    let t = l.trim()
    if not mask.at(i) and (t in ("\\newpage", "\\pagebreak", "\\clearpage")
        or t.match(regex("^<!--\s*pagebreak\s*-->$")) != none) {
      out += ("", pagebreak-line, "")
    } else {
      out.push(l)
    }
  }
  out
}

// Hinweisboxen: ein Zitatblock, dessen erste Zeile "> [!NOTE]" (GitHub) oder
// "> [!HINWEIS]" (deutsch) lautet, wird zu <mdo-alert kind="…"> mit dem
// restlichen Zitatinhalt als Markdown. Text hinter dem Schlüsselwort in
// derselben Zeile gehört zum Inhalt.
#let alert-kinds = (
  NOTE: "note", TIP: "tip", IMPORTANT: "important", WARNING: "warning", CAUTION: "caution",
  INFO: "note", TIPP: "tip", WICHTIG: "important", HINWEIS: "warning", ACHTUNG: "caution",
)
#let alerts(lines) = {
  let mask = code-mask(lines)
  let n = lines.len()
  let out = ()
  let i = 0
  while i < n {
    let m = if mask.at(i) { none } else {
      lines.at(i).match(regex("^ {0,3}>[ \t]?\[!([A-Za-z]+)\][ \t]*(.*)$"))
    }
    let kind = if m == none { none } else { alert-kinds.at(upper(m.captures.at(0)), default: none) }
    if kind == none {
      out.push(lines.at(i))
      i += 1
      continue
    }
    let body = ()
    if m.captures.at(1).trim() != "" { body.push(m.captures.at(1)) }
    i += 1
    while i < n and lines.at(i).match(regex("^ {0,3}>")) != none {
      body.push(lines.at(i).replace(regex("^ {0,3}>[ \t]?"), ""))
      i += 1
    }
    out += ("", "<mdo-alert kind=\"" + kind + "\">", "", ..body, "", "</mdo-alert>", "")
  }
  out
}

// Aufgabenlisten: eine Liste, die NUR aus Aufgaben (- [ ] / - [x]) besteht,
// wird zur Tabelle (<mdo-tasks>, gebaut im Template). Wer/Bis kommen aus dem
// Muster "Aufgabe – Name, bis Datum" (Gedankenstrich mit Leerzeichen; "bis",
// "due" oder "by"). Gemischte oder verschachtelte Listen bleiben Listen.
#let task-re = regex("^[-*+][ \t]+\[([ xX])\][ \t]+(.*)$")
#let item-re = regex("^ {0,3}([-*+]|\d+[.)])([ \t]|$)")
#let task-parts(text) = {
  // letzter " – " / " — " / " - " trennt Aufgabe und Zuständigkeit
  let dash = text.matches(regex(" [–—-] ")).at(-1, default: none)
  if dash == none { return (task: text.trim(), owner: "", due: "") }
  let task = text.slice(0, dash.start).trim()
  let owner = text.slice(dash.end).trim()
  let due = ""
  // "Name, bis Datum" oder nur "bis Datum" (Termin ohne Zuständigkeit)
  let m = owner.match(regex("^(?:(.*?),?\s+)?(?:bis|due|by)\s+(.*)$"))
  if m != none {
    (owner, due) = (if m.captures.at(0) == none { "" } else { m.captures.at(0).trim() }, m.captures.at(1).trim())
  }
  (task: task, owner: owner, due: due)
}
#let attr(s) = s.replace("\"", "'")
#let task-tables(lines) = {
  let mask = code-mask(lines)
  let n = lines.len()
  let out = ()
  let i = 0
  while i < n {
    if mask.at(i) or lines.at(i).match(item-re) == none {
      out.push(lines.at(i))
      i += 1
      continue
    }
    // Ausdehnung der Liste: Einträge, dazwischen höchstens Leerzeilen
    let items = ()
    let j = i
    let other = false
    // Liste über Leerzeilen hinweg, solange ein Eintrag folgt
    let next-item(j) = {
      let k = j
      while k < n and blank(lines.at(k)) { k += 1 }
      if k < n and lines.at(k).match(item-re) != none { k } else { none }
    }
    while j < n {
      let l = lines.at(j)
      if l.match(item-re) != none { items.push(l); j += 1 }
      else if blank(l) and next-item(j) != none { j = next-item(j) }
      else if blank(l) { break }
      else { other = true; break }   // Fortsetzungs-/Unterzeile
    }
    let all-tasks = not other and items.all(x => x.match(task-re) != none)
    if not all-tasks {
      // ganze Liste unverändert übernehmen, inkl. Fortsetzungs- und Unterzeilen
      while j < n {
        if not blank(lines.at(j)) { j += 1 }
        else if next-item(j) != none { j = next-item(j) }
        else if j + 1 < n and lines.at(j + 1).match(regex("^[ 	]+\S")) != none { j += 1 }
        else { break }
      }
      for k in range(i, j) { out.push(lines.at(k)) }
      i = j
      continue
    }
    out += ("", "<mdo-tasks>")
    for x in items {
      let m = x.match(task-re)
      let p = task-parts(m.captures.at(1))
      out += (
        "<mdo-task done=\"" + (if m.captures.at(0) != " " { "true" } else { "false" }) + "\" owner=\"" + attr(p.owner)
          + "\" due=\"" + attr(p.due) + "\">",
        "", p.task, "", "</mdo-task>",
      )
    }
    out += ("</mdo-tasks>", "")
    i = j
  }
  out
}

// Datumszeilen: "18. Oktober 2026" am Zeilenanfang ist ein Datum, keine
// nummerierte Liste ab 18. Stehen nur solche "Einträge" untereinander (alle
// beginnen mit einem Monatsnamen, de/en, auch abgekürzt), wird die Zahl
// maskiert (18\.) und jede Zeile bleibt eine eigene Zeile.
#let months = (
  "januar", "jänner", "februar", "märz", "maerz", "april", "mai", "juni", "juli",
  "august", "september", "oktober", "november", "dezember",
  "jan", "feb", "mär", "mrz", "apr", "jun", "jul", "aug", "sep", "sept", "okt", "nov", "dez",
  "january", "february", "march", "may", "june", "july", "october", "december", "mar", "oct", "dec",
)
#let date-re = regex("^( {0,3})(\d{1,2})([.)])[ \t]+(\S+)(.*)$")
#let is-date-line(l) = {
  let m = l.match(date-re)
  m != none and lower(m.captures.at(3)).trim(regex("[.,]"), at: end) in months
}
#let date-lines(lines) = {
  let mask = code-mask(lines)
  let n = lines.len()
  let out = ()
  let i = 0
  while i < n {
    if mask.at(i) or lines.at(i).match(date-re) == none {
      out.push(lines.at(i))
      i += 1
      continue
    }
    let j = i
    while j < n and not mask.at(j) and lines.at(j).match(date-re) != none { j += 1 }
    let run = lines.slice(i, j)
    if run.all(is-date-line) {
      for (k, l) in run.enumerate() {
        let m = l.match(date-re)
        let c = m.captures
        out.push(c.at(0) + c.at(1) + "\\" + c.at(2) + " " + c.at(3) + c.at(4)
          + if k < run.len() - 1 { "\\" } else { "" })
      }
    } else {
      out += run
    }
    i = j
  }
  out
}

// Harte Zeilenumbrüche (Schalter hard_breaks): jede Zeile innerhalb eines
// Absatzes bleibt eine Zeile, wie im Editor getippt. Technisch ein "\" am
// Zeilenende – aber nur, wenn die Folgezeile denselben Absatz fortsetzt: vor
// einem neuen Block (Liste, Überschrift, Zitat, Tabelle, Zaun …) wäre "\" ein
// sichtbarer Backslash. Code und Formeln bleiben unberührt.
#let block-start-re = regex("^ {0,3}(#{1,6}([ \t]|$)|[-*+]([ \t]|$)|\d+[.)]([ \t]|$)|>|\||`{3,}|~{3,}|\$\$|<|:[ \t]|\[\^[^\]]+\]:|(=+|-+|\*+|_+)[ \t]*$)")
#let keep-line-breaks(lines) = {
  let mask = skip-mask(lines)
  let n = lines.len()
  let out = ()
  for (i, l) in lines.enumerate() {
    if i + 1 >= n or mask.at(i) or mask.at(i + 1) or blank(l) or blank(lines.at(i + 1)) {
      out.push(l)
      continue
    }
    let next = lines.at(i + 1)
    // In Zitaten: beide Zeilen mit ">" und der Folge-Inhalt setzt fort.
    let (cur, nxt) = (l, next)
    let quoted = l.match(regex("^ {0,3}>")) != none
    if quoted {
      if next.match(regex("^ {0,3}>")) == none { out.push(l); continue }
      cur = l.replace(regex("^ {0,3}>[ \t]?"), "")
      nxt = next.replace(regex("^ {0,3}>[ \t]?"), "")
      if blank(cur) or blank(nxt) { out.push(l); continue }
    }
    let ends-break = cur.ends-with("\\") or cur.ends-with("  ")
    let is-heading = cur.match(regex("^ {0,3}#{1,6}([ \t]|$)")) != none
    let is-other = cur.match(regex("^ {0,3}(\||<|`{3,}|~{3,}|\$\$)")) != none
    if ends-break or is-heading or is-other or nxt.match(block-start-re) != none {
      out.push(l)
    } else {
      out.push(l + "\\")
    }
  }
  out
}

// ==Markierung== -> <mark>…</mark> (cmarker -> highlight). Nicht in Code
// (Zäune, Formeln, `Inline-Code`).
#let mark-re = regex("==([^=\s](?:[^=]*[^=\s])?)==")
#let marks(lines) = {
  let mask = skip-mask(lines)
  lines.enumerate().map(((i, l)) => {
    if mask.at(i) or not l.contains("==") { return l }
    // Inline-Code-Spannen auslassen: an Backtick-Läufen teilen, nur die
    // Stücke außerhalb umformen.
    let parts = l.split("`")
    parts.enumerate().map(((k, p)) => if calc.even(k) {
      p.replace(mark-re, m => "<mark>" + m.captures.at(0) + "</mark>")
    } else { p }).join("`")
  })
}

// Bildattribute (Pandoc-Syntax): ![Alt](pfad){width=50%} -> <img …>. cmarkers
// <img>-Handler versteht nur ganze Zahlen (% oder pt), daher hier umrechnen:
// 50% bleibt, 8cm/80mm/2in/12pt -> pt, Zahl ohne Einheit/px -> 0,75 pt je px.
// Ungültige Werte entfallen.
#let dim-attr(v) = {
  let m = v.trim().trim("\"").match(regex("^([0-9]+(?:\.[0-9]+)?)\s*(%|px|pt|mm|cm|in)?$"))
  if m == none { return none }
  let x = float(m.captures.at(0))
  let u = m.captures.at(1)
  if u == "%" { return str(int(calc.round(x))) + "%" }
  let f = if u == none or u == "px" { 0.75 } else { (pt: 1, mm: 2.8346, cm: 28.346, "in": 72).at(u) }
  str(int(calc.round(x * f)))
}
#let image-attr-re = regex("!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)\{([^}]*)\}")
#let image-attrs(lines) = {
  let mask = skip-mask(lines)
  lines.enumerate().map(((i, l)) => {
    if mask.at(i) or not l.contains("){") { return l }
    l.replace(image-attr-re, m => {
      let (alt, src, attrs) = m.captures
      let out = "<img src=\"" + src.replace("\"", "%22") + "\" alt=\"" + alt.replace("\"", "'") + "\""
      for a in attrs.matches(regex("(width|height)\s*=\s*(\"[^\"]*\"|\S+)")) {
        let d = dim-attr(a.captures.at(1))
        if d != none { out += " " + a.captures.at(0) + "=\"" + d + "\"" }
      }
      out + ">"
    })
  })
}

// Typografie (cmarker läuft mit smart-punctuation: false, weil dessen Automatik
// gerade Anführungszeichen immer englisch setzte – auch in deutschem Text):
//   ---  -> —   (Geviertstrich)        --  -> –   (Halbgeviertstrich)
//   ...  -> …   (Auslassungszeichen)
//   "x"  -> „x“ (lang de) bzw. “x” (sonst)   'x' -> ‚x‘ bzw. ‘x’
//   geht's -> geht’s (Apostroph zwischen Buchstaben)
// Getippte typografische Zeichen bleiben unverändert. Nicht angefasst werden
// Code (Zäune, Inline-Code), Formeln ($$-Blöcke, $…$), HTML-Zeilen/-Tags,
// HTML-Kommentare und Trennzeilen (Tabellen, Linien, Setext).
#let rule-line-re = regex("^\s*\|?[\s:|*_=-]+\|?\s*$")
#let opener-re = regex("^[\s(\[{„“‚‘»«–—/-]?$")
#let smart-quotes(t, de) = {
  let (dq-open, dq-close, sq-open, sq-close) = if de { ("„", "“", "‚", "‘") } else { ("“", "”", "‘", "’") }
  let t = t.replace(regex("(^|.)\""), m => {
    let prev = m.captures.at(0)
    prev + if prev.match(opener-re) != none { dq-open } else { dq-close }
  })
  // Apostroph zwischen Buchstaben/Ziffern (geht's, 90's) vor den Anführungen
  let t = t.replace(regex("([\p{L}\p{N}])'([\p{L}])"), m => m.captures.at(0) + "’" + m.captures.at(1))
  t.replace(regex("(^|.)'"), m => {
    let prev = m.captures.at(0)
    prev + if prev.match(opener-re) != none { sq-open } else { sq-close }
  })
}
#let smart-text(t, de, dashes) = {
  let t = if dashes { t.replace("---", "—").replace("--", "–") } else { t }
  smart-quotes(t.replace("...", "…"), de)
}
#let smart-typography(lines, lang) = {
  let mask = skip-mask(lines)
  let de = lang.starts-with("de")
  lines.enumerate().map(((i, l)) => {
    let t = l.trim()
    if mask.at(i) or t.starts-with("<") or t.match(rule-line-re) != none { return l }
    if not (l.contains("\"") or l.contains("'") or l.contains("--") or l.contains("...")) { return l }
    // HTML im Satz (<span …>, <!-- … -->): Zeile nicht anfassen
    if l.match(regex("<[A-Za-z!/]")) != none { return l }
    // Inline-Code auslassen (an Backticks teilen), darin Formeln $…$ auslassen
    l.split("`").enumerate().map(((k, p)) => {
      if calc.odd(k) { return p }
      let dollars = p.split("$")
      if dollars.len() >= 3 and calc.odd(dollars.len()) {
        dollars.enumerate().map(((j, q)) => if calc.odd(j) { q } else { smart-text(q, de, true) }).join("$")
      } else {
        smart-text(p, de, true)
      }
    }).join("`")
  })
}

// Gesamte Vorverarbeitung: Markdown-String für cmarker.
// Tabellen-Einleitung: ein kurzer Absatz (bis 4 Zeilen) direkt vor einer
// Tabelle wird in <mdo-keep> gehüllt; das Template macht daraus einen
// "sticky" Block, damit die Einleitung nie allein unten auf der Seite steht.
#let table-sep-re = regex("^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$")
#let table-intros(lines) = {
  let mask = code-mask(lines)
  let n = lines.len()
  let starts = (:)
  let ends = (:)
  for i in range(1, n) {
    if mask.at(i) or mask.at(i - 1) { continue }
    // Tabellenanfang: Kopfzeile mit | und darunter die Trennzeile.
    if i + 1 >= n or lines.at(i).match(regex("^ {0,3}\|")) == none { continue }
    if lines.at(i + 1).match(table-sep-re) == none or not lines.at(i + 1).contains("-") { continue }
    if not blank(lines.at(i - 1)) { continue }
    let e = i - 1
    while e >= 0 and blank(lines.at(e)) { e -= 1 }
    if e < 0 or mask.at(e) { continue }
    let s = e
    while s > 0 and not blank(lines.at(s - 1)) { s -= 1 }
    let para = lines.slice(s, e + 1)
    if para.len() > 4 { continue }
    if para.any(l => l.match(block-start-re) != none or l.starts-with("    ")) { continue }
    if s > 0 and mask.at(s - 1) { continue }
    // Davor ein normaler Absatz? Dann gilt der Absatzabstand, sonst der
    // Abstand des Blocks davor (Überschrift, Liste, Code, Bild …).
    let p = s - 1
    while p >= 0 and blank(lines.at(p)) { p -= 1 }
    let prev = if p < 0 { "" } else { lines.at(p) }
    let after-par = (p >= 0 and not mask.at(p) and prev.match(block-start-re) == none
      and not prev.starts-with(" ") and not prev.starts-with("\t") and not prev.starts-with("!["))
    starts.insert(str(s), if after-par { "par" } else { "block" })
    ends.insert(str(e), true)
  }
  let out = ()
  for (i, l) in lines.enumerate() {
    if str(i) in starts { out += ("", "<mdo-keep after=\"" + starts.at(str(i)) + "\">", "") }
    out.push(l)
    if str(i) in ends { out += ("", "</mdo-keep>", "") }
  }
  out
}

#let preprocess(src, hard-breaks: false, lang: "de") = {
  let lines = strip-frontmatter(src)
  lines = pagebreaks(lines)
  lines = smart-typography(lines, lang)
  lines = alerts(lines)
  lines = task-tables(lines)
  lines = date-lines(lines)
  lines = table-intros(lines)
  lines = deflists(lines)
  if hard-breaks { lines = keep-line-breaks(lines) }
  lines = marks(lines)
  lines = image-attrs(lines)
  lines.join("\n") + "\n"
}
