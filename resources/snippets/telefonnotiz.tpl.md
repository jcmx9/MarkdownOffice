---
client: "${1:Firma}"
title: "Telefonat mit ${2:Name}"
subtitle: "Telefonnotiz"
date: $CURRENT_DATE.$CURRENT_MONTH.$CURRENT_YEAR, $CURRENT_HOUR:$CURRENT_MINUTE Uhr
hard_breaks: true
embed_source: false
---

# Gespräch

- Telefon: ${3:Nummer}
- Anlass: ${4:Worum ging es?}

# Notizen

$5

# Aufgaben

- [ ] ${6:Aufgabe} – ${7:Name}, bis 
$0
