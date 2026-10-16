---
title: "Diagramm"
---

```mermaid
flowchart LR
  A[Kick-off] --> B{Konzept ok?}
  B -- ja --> C[Design]
  B -- nein --> A
```

```mermaid
sequenceDiagram
  Kunde->>Agentur: Briefing
  Agentur-->>Kunde: Angebot
```

Text nach dem Diagramm.
