# Claude Code Prompt: mdo-web – Komplette Web-Portierung von mdo-cli

---

> **📌 WICHTIG:** Dieser Prompt ist für **Claude Code** (https://claude.ai/code) optimiert.
> **Ziel:** Vollständige Portierung von `mdo-cli` (DIN 5008 Geschäftsbriefe aus Markdown → PDF/A) in eine Web-App.
> **Ergebnis:** Produktionsfertiges Projekt mit Backend (FastAPI) + Frontend (Next.js) + Docker.

---

## 🎯 Projektübersicht

Erstelle eine **produktionsfertige Web-Anwendung** namens **"mdo-web"**, die die **gesamte Funktionalität** von `mdo-cli` (https://github.com/jcmx9/mdo-cli) nachbildet.

### Kernanforderung
- **mdo-cli** generiert **DIN 5008 Form A Geschäftsbriefe** als **PDF/A-2b** aus Markdown (via Pandoc + Typst + din5008a Template).
- Die Web-Version muss **alle Funktionen** des CLI-Tools abdecken:
  - Profil-Verwaltung (`mdo profile`)
  - Brief-Erstellung (`mdo new`)
  - PDF-Kompilierung (`mdo compile`)
  - Template-Verwaltung (`mdo update`)
  - Font-Installation (`mdo install-fonts`)

### Technologie-Stack
| **Schicht**       | **Technologie**               | **Begründung**                          |
|-------------------|--------------------------------|-----------------------------------------|
| **Backend**       | FastAPI (Python 3.12+)        | Wiederverwendung der mdo-cli-Logik     |
| **Frontend**      | Next.js 14+ (App Router)      | Moderne Web-Entwicklung + TypeScript   |
| **Styling**       | Tailwind CSS                  | Schnelles, konsistentes Design          |
| **Markdown-Editor** | Milkdown                      | Vollwertiger Markdown-Editor            |
| **PDF-Rendering** | PDF.js (Mozilla)              | Browser-basierte PDF-Vorschau           |
| **State Management** | Zustand + React Hook Form    | Einfaches State-Management              |
| **Container**     | Docker + Docker Compose      | Lokale Entwicklung & Produktion          |
| **Deployment**    | Vercel (Frontend) + Railway (Backend) | Einfaches Hosting |

---

## 🏗 Architektur

```
mdo-web/
├── backend/                          # FastAPI (Python) + Docker
│   ├── app/
│   │   ├── main.py                   # FastAPI Einstiegspunkt
│   │   ├── routes/
│   │   │   ├── __init__.py
│   │   │   ├── compile.py             # /api/compile (PDF-Generierung)
│   │   │   ├── profiles.py            # /api/profiles/* (CRUD)
│   │   │   ├── letters.py             # /api/letters/* (CRUD)
│   │   │   └── templates.py           # /api/templates/* (Template-Verwaltung)
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── compiler.py            # Kernlogik (portiert von mdo-cli/core/compiler.py)
│   │   │   ├── typst_builder.py       # Typst-Generierung (portiert)
│   │   │   ├── markdown.py            # Markdown → Typst (portiert)
│   │   │   ├── fonts.py               # Font-Verwaltung (portiert)
│   │   │   └── paths.py               # Pfad-Logik (angepasst für Docker)
│   │   └── models/
│   │       ├── __init__.py
│   │       ├── letter.py              # LetterData (portiert)
│   │       └── profile.py             # ProfileConfig (portiert)
│   ├── Dockerfile                     # Python + Pandoc + Typst + Fonts + Template
│   ├── requirements.txt
│   └── pyproject.toml
│
├── frontend/                         # Next.js + React + TypeScript
│   ├── app/
│   │   ├── (app)/
│   │   │   ├── layout.tsx             # Root Layout mit Tailwind
│   │   │   ├── page.tsx               # Dashboard (Brief/Profil-Übersicht)
│   │   │   ├── letters/
│   │   │   │   ├── page.tsx            # Brief-Übersicht
│   │   │   │   ├── [id]/page.tsx       # Einzelner Brief (Bearbeiten/Vorschau)
│   │   │   │   └── new/page.tsx       # Neuer Brief (Formular)
│   │   │   └── profiles/
│   │   │       ├── page.tsx            # Profil-Übersicht
│   │   │       └── [id]/page.tsx       # Profil bearbeiten
│   │   ├── api/
│   │   │   ├── compile/route.ts        # API-Proxy zu Backend
│   │   │   ├── profiles/route.ts       # Profil-API
│   │   │   └── letters/route.ts        # Brief-API
│   │   └── globals.css                 # Tailwind-Direktiven
│   ├── components/
│   │   ├── ui/                        # Wiederverwendbare UI-Komponenten
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   ├── card.tsx
│   │   │   └── dialog.tsx
│   │   ├── LetterEditor.tsx            # Markdown-Editor (Milkdown)
│   │   ├── ProfileForm.tsx             # Profil-Formular
│   │   ├── LetterForm.tsx              # Brief-Formular
│   │   ├── AddressField.tsx            # Adressfeld-Komponente
│   │   ├── PdfPreview.tsx              # PDF-Vorschau (PDF.js)
│   │   └── Navbar.tsx                  # Navigation
│   ├── lib/
│   │   ├── api.ts                      # API-Client (Fetch-Wrapper)
│   │   ├── constants.ts                # App-Konstanten
│   │   └── utils.ts                    # Hilfsfunktionen
│   ├── types/
│   │   └── mdo.ts                      # TypeScript-Typen (aus Python-Modellen)
│   ├── public/                         # Statische Dateien
│   │   └── fonts/                      # Fallback-Fonts (optional)
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   └── tsconfig.json
│
├── docker-compose.yml                 # Lokale Entwicklung
├── docker-compose.prod.yml            # Produktion (optional)
├── .env.example
├── README.md                          # Vollständige Dokumentation
└── .gitignore
```

---

## 🛠 Technische Anforderungen

---

### Backend (FastAPI)

#### Abhängigkeiten
- **Python**: 3.12+
- **FastAPI**: Latest stable
- **Pydantic**: v2+
- **PyYAML**: 6.0+
- **python-multipart**: Für Datei-Uploads

#### Externe Tools (im Docker-Container)
| **Tool**       | **Version**               | **Zweck**                          | **Download** |
|----------------|----------------------------|------------------------------------|--------------|
| **Pandoc**     | Latest                     | Markdown → Typst Konvertierung    | `apt-get install pandoc` |
| **Typst**      | Latest                     | Typst → PDF Kompilierung          | GitHub Releases |
| **Fonts**      | Source Serif 4             | DIN 5008 Standard-Font            | [GitHub](https://github.com/adobe-fonts/source-serif/releases/download/4.000R/source-serif-4.000R.zip) |
|                | Source Sans 3              | DIN 5008 Standard-Font            | [GitHub](https://github.com/adobe-fonts/source-sans/releases/download/3.050R/source-sans-3.050R.zip) |
|                | Source Code Pro            | DIN 5008 Standard-Font            | [GitHub](https://github.com/adobe-fonts/source-code-pro/releases/download/2.042R/source-code-pro-2.042R.zip) |
| **Template**   | din5008a v0.1.1             | DIN 5008 Vorlage                  | [GitHub](https://github.com/jcmx9/typst-DIN5008a) |

#### API-Endpunkte
| **Endpoint**            | **Methode** | **Beschreibung**                          | **mdo-cli Äquivalent** |
|------------------------|-------------|------------------------------------------|------------------------|
| `/api/compile`         | POST        | PDF aus Markdown generieren             | `mdo compile`          |
| `/api/profiles`        | GET         | Alle Profile auflisten                  | –                      |
| `/api/profiles`        | POST        | Neues Profil erstellen                   | `mdo profile`          |
| `/api/profiles/{id}`   | GET         | Profil laden                             | –                      |
| `/api/profiles/{id}`   | PUT         | Profil aktualisieren                     | –                      |
| `/api/profiles/{id}`   | DELETE      | Profil löschen                          | –                      |
| `/api/letters`         | GET         | Alle Briefe auflisten                   | –                      |
| `/api/letters`         | POST        | Neuen Brief erstellen                   | `mdo new`              |
| `/api/letters/{id}`    | GET         | Brief laden                             | –                      |
| `/api/letters/{id}`    | PUT         | Brief aktualisieren                     | –                      |
| `/api/letters/{id}`    | DELETE      | Brief löschen                          | –                      |
| `/api/templates/version` | GET       | Installierte Template-Version prüfen    | `mdo update`           |
| `/api/templates/install` | POST      | Template installieren/updaten           | `mdo update`           |
| `/api/fonts/check`      | GET         | Installierte Fonts prüfen               | `mdo install-fonts`    |
| `/api/fonts/install`    | POST        | Fonts installieren                      | `mdo install-fonts`    |

---

### Frontend (Next.js)

#### Abhängigkeiten
```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@milkdown/core": "^7.0.0",
    "@milkdown/preset-commonmark": "^7.0.0",
    "@milkdown/preset-gfm": "^7.0.0",
    "@milkdown/react": "^7.0.0",
    "@milkdown/theme-nord": "^7.0.0",
    "pdfjs-dist": "^3.4.120",
    "react-hook-form": "^7.48.0",
    "zod": "^3.22.0",
    "zustand": "^4.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@hookform/resolvers": "^3.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.3.0",
    "typescript": "^5.0.0"
  }
}
```

---

## ✨ Zu implementierende Funktionen

---

### 1. Profil-Verwaltung (100% von mdo-cli)

#### Backend (FastAPI)
- **Modell:** `ProfileConfig` (portiert von `mdo-cli/src/mdo/core/models.py:ProfileConfig`)
  ```python
  from pydantic import BaseModel
  from typing import Optional

  class ProfileConfig(BaseModel):
      name: str
      street: str
      zip: str
      city: str
      phone: str = ""
      email: str = ""
      iban: Optional[str] = None
      bic: Optional[str] = None
      bank: Optional[str] = None
      accent: Optional[str] = None  # Hex-Farbe (#RRGGBB)
      qr_code: bool = False
      signature: bool = True
      signature_width: Optional[int] = None  # in mm
      closing: str = "Mit freundlichem Gruß"
      open: bool = True
      reveal: bool = True
  ```

- **Endpunkte:**
  - `GET /api/profiles` → Liste aller Profile
  - `GET /api/profiles/{id}` → Profil laden
  - `POST /api/profiles` → Profil erstellen
  - `PUT /api/profiles/{id}` → Profil aktualisieren
  - `DELETE /api/profiles/{id}` → Profil löschen

#### Frontend (Next.js)
- **Seiten:**
  - `/profiles` → Profil-Übersicht (Tabelle mit allen Profilen)
  - `/profiles/new` → Neues Profil erstellen
  - `/profiles/{id}` → Profil bearbeiten
- **Komponenten:**
  - `ProfileForm.tsx` → Formular für Profil-Daten
  - `ProfileCard.tsx` → Karte zur Anzeige eines Profils

---

### 2. Brief-Verwaltung (100% von mdo-cli)

#### Backend (FastAPI)
- **Modell:** `LetterData` (portiert von `mdo-cli/src/mdo/core/models.py:LetterData`)
  ```python
  from pydantic import BaseModel
  from typing import Optional, List
  from datetime import date

  class LetterData(BaseModel):
      # Sender (von Profil)
      name: str
      street: str
      zip: str
      city: str
      phone: str = ""
      email: str = ""
      iban: Optional[str] = None
      bic: Optional[str] = None
      bank: Optional[str] = None
      qr_code: bool = False
      signature: Optional[str] = None
      signature_width: Optional[int] = None
      closing: str = "Mit freundlichem Gruß"
      
      # Brief
      date: Optional[str] = None  # Format: "05. April 2026" oder "2026-04-05"
      subject: str = ""
      recipient: List[str]  # Adresszeilen
      attachments: List[str] = []
      body: str  # Markdown-Inhalt
      
      # Optionen
      open: bool = False
      reveal: bool = False
  ```

- **Endpunkte:**
  - `GET /api/letters` → Liste aller Briefe
  - `GET /api/letters/{id}` → Brief laden
  - `POST /api/letters` → Brief erstellen
  - `PUT /api/letters/{id}` → Brief aktualisieren
  - `DELETE /api/letters/{id}` → Brief löschen

#### Frontend (Next.js)
- **Seiten:**
  - `/letters` → Brief-Übersicht (Tabelle mit allen Briefen)
  - `/letters/new` → Neuer Brief (Formular + Markdown-Editor)
  - `/letters/{id}` → Brief bearbeiten
- **Komponenten:**
  - `LetterForm.tsx` → Formular für Brief-Daten
  - `LetterEditor.tsx` → Markdown-Editor (Milkdown)
  - `LetterCard.tsx` → Karte zur Anzeige eines Briefs
  - `AddressField.tsx` → Dynamisches Adressfeld

---

### 3. PDF-Kompilierung (KERNFUNKTION – muss exakt mdo-cli entsprechen!)

#### Backend: `/api/compile` Endpunkt

**Eingabe:** Vollständige Brief-Daten (`LetterData`)

**Prozess:**
1. **Markdown generieren** (YAML Frontmatter + Body)
   ```python
   def generate_markdown(letter: LetterData) -> str:
       frontmatter = {
           "name": letter.name,
           "street": letter.street,
           "zip": letter.zip,
           "city": letter.city,
           "phone": letter.phone,
           "email": letter.email,
           "iban": letter.iban,
           "bic": letter.bic,
           "bank": letter.bank,
           "qr_code": letter.qr_code,
           "signature": letter.signature,
           "signature_width": letter.signature_width,
           "closing": letter.closing,
           "date": letter.date,
           "subject": letter.subject,
           "recipient": letter.recipient,
           "attachments": letter.attachments,
       }
       yaml_str = "---\n" + yaml.dump(frontmatter, allow_unicode=True) + "---\n\n"
       return yaml_str + letter.body
   ```

2. **Markdown → Typst (via Pandoc)**
   ```python
   def md_to_typst(markdown: str) -> str:
       result = subprocess.run(
           ["pandoc", "-f", "markdown", "-t", "typst"],
           input=markdown,
           capture_output=True,
           text=True,
           check=True,
       )
       # Pandoc fügt <label> Tags hinzu – entfernen
       return re.sub(r"\n<[^>]+>", "\n", result.stdout)
   ```

3. **Typst + Template kombinieren**
   ```python
   def build_typst_content(data: LetterData, typst_body: str) -> tuple[str, str]:
       version = find_installed_version()  # din5008a Version
       
       json_data = {
           "sender": data.sender_dict(),
           "recipient": data.recipient,
           "date": data.date,
           "subject": data.subject,
           "closing": data.closing,
           "signature": data.signature,
           "signature_width": data.signature_width,
           "accent": data.accent,
           "attachments": data.attachments,
       }
       json_content = json.dumps(json_data, ensure_ascii=False, indent=2)
       
       sig_width_line = "\n  signature-width: sig-width," if data.signature_width else ""
       accent_line = "\n  accent: rgb(data.accent)," if data.accent else ""
       
       typst_content = f"""\
#import "@local/din5008a:{version}": din5008a, bullet
#let data = json("brief.json")
#let sig = if data.signature != none {{ read(data.signature) }} else {{ none }}
#let sig-width = if data.at("signature_width", default: none) != none {{ data.signature_width * 1mm }} else {{ none }}

#show: din5008a.with(
  sender: data.sender,
  recipient: data.recipient,
  date: data.date,
  subject: data.subject,
  closing: data.closing,
  signature: sig,{sig_width_line}{accent_line}
  attachments: data.at("attachments", default: ()),
)

{typst_body}
"""
       return typst_content, json_content
   ```

4. **Typst → PDF/A-2b kompilieren**
   ```python
   def compile_typst_to_pdf(typst_content: str, json_content: str) -> bytes:
       with tempfile.TemporaryDirectory() as tmpdir:
           tmpdir_path = Path(tmpdir)
           
           # Typst-Datei schreiben
           typ_path = tmpdir_path / "brief.typ"
           typ_path.write_text(typst_content)
           
           # JSON-Datei schreiben
           json_path = tmpdir_path / "brief.json"
           json_path.write_text(json_content)
           
           # PDF generieren
           pdf_path = tmpdir_path / "brief.pdf"
           subprocess.run([
               "typst", "compile",
               "--root", "/app/templates",
               "--font-path", "/app/fonts",
               "--pdf-standard", "a-2b",  # 🎯 WICHTIG: PDF/A-2b Standard
               str(typ_path),
               str(pdf_path),
           ], check=True)
           
           return pdf_path.read_bytes()
   ```

5. **PDF zurückgeben**
   ```python
   @router.post("/api/compile")
   async def compile_letter(letter: LetterData):
       markdown = generate_markdown(letter)
       typst_body = md_to_typst(markdown)
       typst_content, json_content = build_typst_content(letter, typst_body)
       pdf_bytes = compile_typst_to_pdf(typst_content, json_content)
       
       filename = f"{letter.date or 'brief'}_{letter.recipient[0]} - {letter.subject}.pdf"
       return StreamingResponse(
           iter([pdf_bytes]),
           media_type="application/pdf",
           headers={"Content-Disposition": f"attachment; filename={filename}"}
       )
   ```

#### Frontend: PDF-Generierung
- **API-Client:**
  ```typescript
  // lib/api.ts
  import { LetterData } from '@/types/mdo';

  export async function compileLetter(data: LetterData): Promise<Blob> {
    const response = await fetch('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'PDF generation failed');
    }
    
    return response.blob();
  }
  ```

- **Komponente:**
  ```tsx
  // components/LetterForm.tsx
  const handleSubmit = async (data: LetterData) => {
    setIsLoading(true);
    try {
      const blob = await compileLetter(data);
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };
  ```

---

### 4. Template-Verwaltung

- **Endpoint:** `GET /api/templates/version` → Installierte Version prüfen
- **Endpoint:** `POST /api/templates/install` → Template installieren/updaten
- **Logik:**
  ```python
  # services/templates.py
  import subprocess
  from pathlib import Path
  
  TEMPLATE_REPO = "https://github.com/jcmx9/typst-DIN5008a.git"
  TEMPLATE_DIR = Path("/app/templates/local/din5008a")
  
  def install_template():
      subprocess.run([
          "git", "clone", TEMPLATE_REPO, 
          str(TEMPLATE_DIR / "0.1.1")
      ], check=True)
      
      # Symlink für Typst erstellen
      packages_dir = Path("/app/templates/packages/local/din5008a")
      packages_dir.parent.mkdir(parents=True, exist_ok=True)
      (packages_dir / "0.1.1").symlink_to(TEMPLATE_DIR / "0.1.1")
  
  def get_installed_version():
      if (TEMPLATE_DIR / "0.1.1").exists():
          return "0.1.1"
      return None
  ```

---

### 5. Font-Verwaltung

- **Endpoint:** `GET /api/fonts/check` → Fehlende Fonts prüfen
- **Endpoint:** `POST /api/fonts/install` → Fonts installieren
- **Logik:**
  ```python
  # services/fonts.py
  from pathlib import Path
  
  FONTS_DIR = Path("/app/fonts")
  REQUIRED_FONTS = ["SourceSerif4", "SourceSans3", "SourceCodePro"]
  
  def check_fonts():
      missing = []
      for font in REQUIRED_FONTS:
          if not (FONTS_DIR / font).exists():
              missing.append(font)
      return missing
  
  def install_fonts():
      FONTS = {
          "SourceSerif4": "https://github.com/adobe-fonts/source-serif/releases/download/4.000R/source-serif-4.000R.zip",
          "SourceSans3": "https://github.com/adobe-fonts/source-sans/releases/download/3.050R/source-sans-3.050R.zip",
          "SourceCodePro": "https://github.com/adobe-fonts/source-code-pro/releases/download/2.042R/source-code-pro-2.042R.zip",
      }
      
      for font_name, url in FONTS.items():
          import wget
          import zipfile
          
          zip_path = FONTS_DIR / f"{font_name}.zip"
          wget.download(url, str(zip_path))
          
          with zipfile.ZipFile(zip_path, 'r') as zip_ref:
              zip_ref.extractall(FONTS_DIR / font_name)
          
          zip_path.unlink()
  ```

---

## 📂 Dateistruktur-Details

---

### Backend-Dateien

```
backend/
├── Dockerfile
├── requirements.txt
├── pyproject.toml
└── app/
    ├── main.py                     # FastAPI App
    │
    ├── routes/
    │   ├── __init__.py
    │   ├── compile.py               # PDF-Generierung
    │   ├── profiles.py              # Profil-CRUD
    │   ├── letters.py               # Brief-CRUD
    │   └── templates.py             # Template-Verwaltung
    │
    ├── services/
    │   ├── __init__.py
    │   ├── compiler.py              # Kernlogik (portiert)
    │   ├── typst_builder.py         # Typst-Generierung (portiert)
    │   ├── markdown.py              # Markdown → Typst (portiert)
    │   ├── fonts.py                 # Font-Verwaltung (portiert)
    │   └── paths.py                 # Pfad-Logik (angepasst)
    │
    └── models/
        ├── __init__.py
        ├── letter.py                # LetterData (portiert)
        └── profile.py               # ProfileConfig (portiert)
```

#### `backend/app/main.py`
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes import compile, profiles, letters, templates

app = FastAPI(
    title="mdo-service API",
    description="DIN 5008 business letters as PDF/A from Markdown",
    version="1.0.0",
)

# CORS für Entwicklung
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routen registrieren
app.include_router(compile.router)
app.include_router(profiles.router)
app.include_router(letters.router)
app.include_router(templates.router)

@app.get("/")
async def root():
    return {"message": "mdo-service API"}
```

#### `backend/app/routes/compile.py`
```python
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from typing import Optional
from ..models.letter import LetterData
from ..services.compiler import compile_letter_in_memory

router = APIRouter(prefix="/api", tags=["compile"])

@router.post("/compile")
async def compile_letter(letter: LetterData):
    """
    Compile a letter to PDF/A-2b using the DIN 5008 template.
    
    This is the main endpoint – it replicates `mdo compile <filename.md>`.
    """
    try:
        pdf_bytes = compile_letter_in_memory(letter)
        filename = f"{letter.date or 'brief'}_{letter.recipient[0]} - {letter.subject}.pdf"
        return StreamingResponse(
            iter([pdf_bytes]),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF generation failed: {str(e)}"
        )
```

#### `backend/app/services/compiler.py`
```python
"""
Core compilation pipeline – ported from mdo-cli/src/mdo/core/compiler.py
Adapted for in-memory operation (no file I/O except temp files).
"""
import subprocess
import tempfile
import json
import re
from pathlib import Path
from typing import Optional
from ..models.letter import LetterData
from .typst_builder import build_typst_content
from .markdown import md_to_typst


def compile_letter_in_memory(letter: LetterData) -> bytes:
    """
    Compile LetterData to PDF/A-2b in memory.
    Returns: PDF as bytes
    """
    # 1. Generate Markdown from LetterData
    markdown = generate_markdown(letter)
    
    # 2. Convert Markdown to Typst
    typst_body = md_to_typst(markdown)
    
    # 3. Build Typst + JSON content
    typst_content, json_content = build_typst_content(letter, typst_body)
    
    # 4. Compile to PDF using temp directory
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        
        # Write files
        typ_path = tmpdir_path / "brief.typ"
        json_path = tmpdir_path / "brief.json"
        typ_path.write_text(typst_content, encoding="utf-8")
        json_path.write_text(json_content, encoding="utf-8")
        
        # Compile
        pdf_path = tmpdir_path / "brief.pdf"
        result = subprocess.run([
            "typst", "compile",
            "--root", "/app/templates",
            "--font-path", "/app/fonts",
            "--pdf-standard", "a-2b",
            str(typ_path),
            str(pdf_path),
        ], capture_output=True, text=True)
        
        if result.returncode != 0:
            raise RuntimeError(f"Typst compilation failed: {result.stderr}")
        
        return pdf_path.read_bytes()


def generate_markdown(letter: LetterData) -> str:
    """Generate Markdown with YAML frontmatter from LetterData."""
    import yaml
    
    frontmatter = {
        "name": letter.name,
        "street": letter.street,
        "zip": letter.zip,
        "city": letter.city,
        "phone": letter.phone,
        "email": letter.email,
        "iban": letter.iban,
        "bic": letter.bic,
        "bank": letter.bank,
        "qr_code": letter.qr_code,
        "signature": letter.signature,
        "signature_width": letter.signature_width,
        "closing": letter.closing,
        "date": letter.date,
        "subject": letter.subject,
        "recipient": letter.recipient,
        "attachments": letter.attachments,
    }
    
    yaml_str = "---\n" + yaml.dump(frontmatter, allow_unicode=True, default_flow_style=False) + "---\n\n"
    return yaml_str + letter.body
```

---

### Frontend-Dateien

```
frontend/
├── app/
│   ├── (app)/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── letters/
│   │   │   ├── page.tsx
│   │   │   ├── [id]/page.tsx
│   │   │   └── new/page.tsx
│   │   └── profiles/
│   │       ├── page.tsx
│   │       └── [id]/page.tsx
│   └── api/
│       ├── compile/route.ts
│       ├── profiles/route.ts
│       └── letters/route.ts
│
├── components/
│   ├── ui/
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── card.tsx
│   │   └── dialog.tsx
│   ├── LetterEditor.tsx
│   ├── ProfileForm.tsx
│   ├── LetterForm.tsx
│   ├── AddressField.tsx
│   ├── PdfPreview.tsx
│   └── Navbar.tsx
│
├── lib/
│   ├── api.ts
│   ├── constants.ts
│   └── utils.ts
│
├── types/
│   └── mdo.ts
│
└── public/
```

#### `frontend/types/mdo.ts`
```typescript
// TypeScript-Typen, abgeleitet von Python-Modellen in mdo-cli/src/mdo/core/models.py

// Profil-Daten (von ProfileConfig)
export interface Profile {
  name: string;
  street: string;
  zip: string;
  city: string;
  phone: string;
  email: string;
  iban: string | null;
  bic: string | null;
  bank: string | null;
  accent: string | null;  // Hex-Farbe (#RRGGBB)
  qr_code: boolean;
  signature: boolean;
  signature_width: number | null;  // in mm
  closing: string;
  open: boolean;
  reveal: boolean;
}

// Brief-Daten (von LetterData)
export interface Letter {
  // Sender (von Profil)
  name: string;
  street: string;
  zip: string;
  city: string;
  phone: string;
  email: string;
  iban: string | null;
  bic: string | null;
  bank: string | null;
  qr_code: boolean;
  signature: string | boolean | null;
  signature_width: number | null;
  closing: string;
  
  // Brief
  date: string | null;  // Format: "05. April 2026" oder "2026-04-05"
  subject: string;
  recipient: string[];  // Adresszeilen
  attachments: string[];
  body: string;  // Markdown-Inhalt
  
  // Optionen
  open: boolean;
  reveal: boolean;
}

// API-Response-Typen
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface CompileResponse {
  pdf: Blob;  // PDF als Blob
  filename: string;
}
```

#### `frontend/app/(app)/letters/new/page.tsx`
```tsx
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { LetterEditor } from "@/components/LetterEditor";
import { AddressField } from "@/components/AddressField";
import { Button } from "@/components/ui/button";
import { compileLetter } from "@/lib/api";
import { Letter } from "@/types/mdo";
import { toast } from "sonner";

// Zod-Schema für Validierung
const letterSchema = z.object({
  // Sender
  name: z.string().min(1, "Name ist Pflichtfeld"),
  street: z.string().min(1, "Straße ist Pflichtfeld"),
  zip: z.string().min(1, "PLZ ist Pflichtfeld"),
  city: z.string().min(1, "Ort ist Pflichtfeld"),
  phone: z.string().optional(),
  email: z.string().email("Ungültige E-Mail").optional(),
  iban: z.string().optional().nullable(),
  bic: z.string().optional().nullable(),
  bank: z.string().optional().nullable(),
  qr_code: z.boolean().default(false),
  signature: z.union([z.string(), z.boolean()]).optional().nullable(),
  signature_width: z.number().optional().nullable(),
  closing: z.string().default("Mit freundlichem Gruß"),
  
  // Brief
  date: z.string().optional().nullable(),
  subject: z.string().min(1, "Betreff ist Pflichtfeld"),
  recipient: z.array(z.string().min(1)).min(1, "Mindestens eine Empfängerzeile"),
  attachments: z.array(z.string()).default([]),
  body: z.string().default("Sehr geehrte Damen und Herren,\n\n\n"),
});

type LetterFormData = z.infer<typeof letterSchema>;

export default function NewLetterPage() {
  const router = useRouter();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const { 
    register, 
    handleSubmit, 
    setValue, 
    watch, 
    formState: { errors } 
  } = useForm<LetterFormData>({
    resolver: zodResolver(letterSchema),
    defaultValues: letterSchema.parse({
      name: "Max Mustermann",
      street: "Musterstraße 1",
      zip: "12345",
      city: "Musterstadt",
      subject: "Bewerbung",
      recipient: ["Firma GmbH", "Herrn Max Müller"],
      body: "Sehr geehrte Damen und Herren,\n\nHier mein Text.\n\nMit freundlichen Grüßen",
    }),
  });

  const onSubmit = async (data: LetterFormData) => {
    setIsLoading(true);
    try {
      // Daten für API anpassen
      const letterData: Letter = {
        ...data,
        // Standardwerte für optionale Felder
        phone: data.phone || "",
        email: data.email || "",
      };
      
      const blob = await compileLetter(letterData);
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      toast.success("PDF erfolgreich generiert!");
    } catch (error) {
      toast.error(`Fehler: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Neuer Brief</h1>
        <p className="text-muted-foreground">
          Erstelle einen neuen Geschäftsbrief nach DIN 5008 Form A
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Absender-Daten */}
        <div className="border rounded-lg p-4 space-y-4">
          <h2 className="text-xl font-semibold">Absender</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Name *
              </label>
              <input
                id="name"
                {...register("name")}
                className="w-full p-2 border rounded-md"
                placeholder="Max Mustermann"
              />
              {errors.name && (
                <p className="text-red-500 text-sm">{errors.name.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <label htmlFor="street" className="text-sm font-medium">
                Straße *
              </label>
              <input
                id="street"
                {...register("street")}
                className="w-full p-2 border rounded-md"
                placeholder="Musterstraße 1"
              />
              {errors.street && (
                <p className="text-red-500 text-sm">{errors.street.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <label htmlFor="zip" className="text-sm font-medium">
                PLZ *
              </label>
              <input
                id="zip"
                {...register("zip")}
                className="w-full p-2 border rounded-md"
                placeholder="12345"
              />
              {errors.zip && (
                <p className="text-red-500 text-sm">{errors.zip.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <label htmlFor="city" className="text-sm font-medium">
                Ort *
              </label>
              <input
                id="city"
                {...register("city")}
                className="w-full p-2 border rounded-md"
                placeholder="Musterstadt"
              />
              {errors.city && (
                <p className="text-red-500 text-sm">{errors.city.message}</p>
              )}
            </div>
            
            <div className="space-y-2">
              <label htmlFor="phone" className="text-sm font-medium">
                Telefon
              </label>
              <input
                id="phone"
                {...register("phone")}
                className="w-full p-2 border rounded-md"
                placeholder="0123 456789"
              />
            </div>
            
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                E-Mail
              </label>
              <input
                id="email"
                type="email"
                {...register("email")}
                className="w-full p-2 border rounded-md"
                placeholder="max@example.de"
              />
              {errors.email && (
                <p className="text-red-500 text-sm">{errors.email.message}</p>
              )}
            </div>
          </div>
          
          {/* Bankdaten (optional) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label htmlFor="iban" className="text-sm font-medium">
                IBAN
              </label>
              <input
                id="iban"
                {...register("iban")}
                className="w-full p-2 border rounded-md"
                placeholder="DE89 3704 0044 0532 0130 00"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="bic" className="text-sm font-medium">
                BIC
              </label>
              <input
                id="bic"
                {...register("bic")}
                className="w-full p-2 border rounded-md"
                placeholder="COBADEFFXXX"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="bank" className="text-sm font-medium">
                Bank
              </label>
              <input
                id="bank"
                {...register("bank")}
                className="w-full p-2 border rounded-md"
                placeholder="Commerzbank"
              />
            </div>
          </div>
          
          {/* Sonstige Optionen */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Akzentfarbe (optional)
              </label>
              <div className="flex gap-2">
                <input
                  type="color"
                  {...register("accent")}
                  className="w-10 h-10"
                />
                <input
                  {...register("accent")}
                  className="flex-1 p-2 border rounded-md"
                  placeholder="#B03060"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                vCard-QR-Code
              </label>
              <select {...register("qr_code")} className="w-full p-2 border rounded-md">
                <option value="false">Nein</option>
                <option value="true">Ja</option>
              </select>
            </div>
          </div>
        </div>

        {/* Brief-Daten */}
        <div className="border rounded-lg p-4 space-y-4">
          <h2 className="text-xl font-semibold">Brief</h2>
          
          <div className="space-y-2">
            <label htmlFor="date" className="text-sm font-medium">
              Datum (optional, Standard: heute)
            </label>
            <input
              id="date"
              type="date"
              {...register("date")}
              className="w-full p-2 border rounded-md"
            />
          </div>
          
          <div className="space-y-2">
            <label htmlFor="subject" className="text-sm font-medium">
              Betreff *
            </label>
            <input
              id="subject"
              {...register("subject")}
              className="w-full p-2 border rounded-md"
              placeholder="Bewerbung als Softwareentwickler"
            />
            {errors.subject && (
              <p className="text-red-500 text-sm">{errors.subject.message}</p>
            )}
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Empfänger * (je Zeile eine Adresszeile)
            </label>
            <AddressField
              lines={watch("recipient")}
              onChange={(lines) => setValue("recipient", lines)}
              errors={errors.recipient}
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Anlagen (optional)
            </label>
            {/* Hier könnte ein dynamisches Feld für Anlagen kommen */}
            <input
              className="w-full p-2 border rounded-md"
              placeholder="Lebenslauf, Zeugnisse"
            />
          </div>
        </div>

        {/* Markdown-Editor */}
        <div className="border rounded-lg p-4 space-y-4">
          <h2 className="text-xl font-semibold">Brieftext (Markdown)</h2>
          <p className="text-sm text-muted-foreground">
            Nutze Markdown für Formatierungen: **Fett**, *kursiv*, `- Aufzählungen`, etc.
          </p>
          <LetterEditor
            value={watch("body")}
            onChange={(value) => setValue("body", value)}
          />
        </div>

        {/* Submit-Button */}
        <div className="flex gap-2">
          <Button type="submit" disabled={isLoading} className="flex-1">
            {isLoading ? "Generiere PDF..." : "PDF generieren"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/letters")}>
            Abbrechen
          </Button>
        </div>
      </form>

      {/* PDF-Vorschau */}
      {pdfUrl && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-4 max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">PDF-Vorschau</h2>
              <Button variant="ghost" onClick={() => setPdfUrl(null)}>
                ✕ Schließen
              </Button>
            </div>
            <div className="border rounded-md overflow-hidden">
              <iframe
                src={pdfUrl}
                className="w-full h-[500px]"
                title="PDF-Vorschau"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <Button asChild>
                <a href={pdfUrl} download="brief.pdf">
                  PDF herunterladen
                </a>
              </Button>
              <Button variant="outline" onClick={() => window.open(pdfUrl, "_blank")}>
                In neuem Tab öffnen
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

#### `frontend/components/LetterEditor.tsx`
```tsx
"use client";

import { useEffect, useRef } from "react";
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { nord } from "@milkdown/theme-nord";
import { MilkdownProvider, useEditor } from "@milkdown/react";

interface LetterEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function LetterEditor({ value, onChange, className }: LetterEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editorRef.current) return;

    const editor = Editor.make()
      .config((ctx) => {
        // Set initial value
        ctx.set(defaultValueCtx, value);
        
        // Update on change
        ctx.onChange((ctx) => {
          onChange(ctx.get(defaultValueCtx));
        });
      })
      .use(nord)
      .use(commonmark)
      .use(gfm);

    const instance = editor.create();
    editorRef.current.appendChild(instance.root);

    return () => {
      instance.destroy();
    };
  }, [value, onChange]);

  return (
    <MilkdownProvider>
      <div
        ref={editorRef}
        className={`border rounded-md min-h-[300px] bg-white ${className}`}
      />
    </MilkdownProvider>
  );
}
```

#### `frontend/components/AddressField.tsx`
```tsx
"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Trash2, Plus } from "lucide-react";
import { FieldError } from "react-hook-form";

interface AddressFieldProps {
  lines: string[];
  onChange: (lines: string[]) => void;
  errors?: FieldError | undefined;
  label?: string;
}

export function AddressField({ 
  lines, 
  onChange, 
  errors,
  label = "Adresszeilen"
}: AddressFieldProps) {
  const addLine = () => {
    onChange([...lines, ""]);
  };

  const removeLine = (index: number) => {
    const newLines = [...lines];
    newLines.splice(index, 1);
    onChange(newLines);
  };

  const updateLine = (index: number, value: string) => {
    const newLines = [...lines];
    newLines[index] = value;
    onChange(newLines);
  };

  return (
    <div className="space-y-2">
      {label && <label className="text-sm font-medium">{label}</label>}
      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={index} className="flex gap-2">
            <Input
              value={line}
              onChange={(e) => updateLine(index, e.target.value)}
              placeholder={`Zeile ${index + 1}`}
              className="flex-1"
            />
            {lines.length > 1 && (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                onClick={() => removeLine(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
        {errors && (
          <p className="text-red-500 text-sm">{errors.message}</p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addLine}
          className="w-full"
        >
          <Plus className="h-4 w-4 mr-2" />
          Weitere Zeile hinzufügen
        </Button>
      </div>
    </div>
  );
}
```

---

## 🐳 Docker-Konfiguration

---

### `Dockerfile` (Backend)
```dockerfile
# === Backend Dockerfile ===
# Base Image
FROM python:3.12-slim as backend

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    pandoc \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Typst
RUN wget -qO- https://github.com/typst/typst/releases/latest/download/typst-x86_64-unknown-linux-musl.tar.xz | \
    tar -xJ -C /usr/local/bin

# Clone din5008a template
RUN git clone --depth 1 --branch v0.1.1 https://github.com/jcmx9/typst-DIN5008a.git /app/templates/local/din5008a/0.1.1 && \
    mkdir -p /app/templates/packages/local && \
    ln -sf /app/templates/local/din5008a/0.1.1 /app/templates/packages/local/din5008a

# Install fonts
RUN mkdir -p /app/fonts && \
    # Source Serif 4
    wget -q https://github.com/adobe-fonts/source-serif/releases/download/4.000R/source-serif-4.000R.zip -O /tmp/source-serif.zip && \
    unzip -q /tmp/source-serif.zip -d /app/fonts && \
    rm -f /tmp/source-serif.zip && \
    # Source Sans 3
    wget -q https://github.com/adobe-fonts/source-sans/releases/download/3.050R/source-sans-3.050R.zip -O /tmp/source-sans.zip && \
    unzip -q /tmp/source-sans.zip -d /app/fonts && \
    rm -f /tmp/source-sans.zip && \
    # Source Code Pro
    wget -q https://github.com/adobe-fonts/source-code-pro/releases/download/2.042R/source-code-pro-2.042R.zip -O /tmp/source-code-pro.zip && \
    unzip -q /tmp/source-code-pro.zip -d /app/fonts && \
    rm -f /tmp/source-code-pro.zip

# Install Python dependencies
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/app ./app

# Set working directory
WORKDIR /app

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### `frontend/Dockerfile`
```dockerfile
# === Frontend Dockerfile ===
# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY frontend/package.json frontend/package-lock.json* frontend/tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy all frontend files
COPY frontend .

# Build the application
RUN npm run build

# Stage 2: Run
FROM node:18-alpine AS runner

WORKDIR /app

# Set environment variables
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# Copy built files from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# Expose port
EXPOSE 3000

# Run the application
CMD ["npm", "start"]
```

### `docker-compose.yml`
```yaml
version: "3.8"

services:
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    container_name: mdo-backend
    ports:
      - "8000:8000"
    volumes:
      - ./backend/app:/app/app
      - mdo-temp:/tmp
    environment:
      - PYTHONUNBUFFERED=1
      - PYTHONDONTWRITEBYTECODE=1
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend:
    build:
      context: .
      dockerfile: frontend/Dockerfile
    container_name: mdo-frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:8000
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped

volumes:
  mdo-temp:
```

---

## 🚀 Deployment

---

### Lokale Entwicklung

```bash
# 1. Repository klonen
cd /Users/rolandkreus/GitHub
mkdir mdo-service && cd mdo-service

# 2. Projekt-Struktur erstellen
mkdir -p backend/app/routes backend/app/services backend/app/models
mkdir -p frontend/app/\(app\)/letters frontend/app/\(app\)/profiles frontend/app/api
mkdir -p frontend/components/ui frontend/components frontend/lib frontend/types

# 3. Docker-Container starten
docker-compose up -d --build

# 4. App aufrufen
# Frontend: http://localhost:3000
# Backend:  http://localhost:8000
# API-Docs: http://localhost:8000/docs
```

### Produktion (Vercel + Railway)

#### Backend (Railway)
1. GitHub-Repository mit dem Projekt erstellen
2. Bei Railway:
   - "New Project" → "From GitHub Repository"
   - Backend-Verzeichnis auswählen
   - Environment Variables:
     - Keine nötig (Standard-Konfiguration)
4. Bereit!

#### Frontend (Vercel)
1. Bei Vercel:
   - "Add New" → "Project"
   - GitHub-Repository auswählen
   - Frontend-Verzeichnis auswählen
   - Environment Variables:
     - `NEXT_PUBLIC_API_URL=https://<backend-name>.up.railway.app`
2. Bereit!

---

## 📄 Umgebungsvariablen

### `.env.example`
```env
# Backend (wird von Docker verwendet)
# Keine Variablen nötig

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### `backend/requirements.txt`
```text
fastapi>=0.109.0
uvicorn>=0.27.0
pydantic>=2.5.0
pyyaml>=6.0
python-multipart>=0.0.6
```

### `frontend/package.json` (Auszug)
```json
{
  "name": "mdo-web",
  "version": "1.0.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@milkdown/core": "^7.0.0",
    "@milkdown/preset-commonmark": "^7.0.0",
    "@milkdown/preset-gfm": "^7.0.0",
    "@milkdown/react": "^7.0.0",
    "@milkdown/theme-nord": "^7.0.0",
    "@radix-ui/react-dropdown-menu": "^2.0.0",
    "@radix-ui/react-slot": "^1.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.0.0",
    "lucide-react": "^0.294.0",
    "pdfjs-dist": "^3.4.120",
    "react-hook-form": "^7.48.0",
    "sonner": "^1.3.0",
    "tailwind-merge": "^2.1.0",
    "tailwindcss-animate": "^1.0.7",
    "zod": "^3.22.0",
    "zustand": "^4.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@hookform/resolvers": "^3.3.0",
    "@types/pdfjs-dist": "^2.10.389",
    "autoprefixer": "^10.4.0",
    "eslint": "^8.0.0",
    "eslint-config-next": "^14.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.3.0",
    "typescript": "^5.0.0"
  }
}
```

---

## 📚 Zusätzliche Anforderungen

---

### 1. Fehlerbehandlung

#### Backend
- **HTTP-Status-Codes** korrekt verwenden:
  - `400 Bad Request` → Ungültige Eingabedaten
  - `404 Not Found` → Ressource nicht gefunden
  - `500 Internal Server Error` → Server-Fehler
- **Fehlermeldungen** müssen **deskriptiv** sein

#### Frontend
- **Benutzerfreundliche Fehlermeldungen** (Toast-Benachrichtigungen)
- **Loading-States** für alle asynchronen Operationen
- **Formular-Validierung** (client-seitig mit Zod)

---

### 2. Validierung

#### Backend
- **Pydantic** für alle Eingabevalidierungen
- **Keine manuelle Validierung** nötig

#### Frontend
- **Zod** für Schema-Validierung
- **React Hook Form** für Formular-Validierung
- **Client-seitige Validierung** vor dem Senden

---

### 3. Sicherheit

- **CORS** nur für Frontend-Domains aktivieren (in Produktion)
- **Keine arbiträren Dateizugriffe** (Pfad-Validierung wie in `mdo-cli`)
- **Eingaben sanitizen** (z. B. für Dateinamen)
- **CSRF-Schutz** für Formulare (optional)

---

### 4. Performance

#### Backend
- **Temporäre Dateien** in `/tmp` speichern (automatische Bereinigung)
- **Subprocess-Calls** effizient ausführen

#### Frontend
- **Lazy Loading** für schwere Komponenten (Milkdown-Editor)
- **Code-Splitting** für Next.js
- **Caching** von API-Antworten

---

### 5. Barrierefreiheit (Accessibility)

- **Semantisches HTML** verwenden
- **ARIA-Attribute** wo nötig
- **Keyboard-Navigation** unterstützen
- **Screenreader-kompatibel**

---

### 6. Testing

#### Backend
- **Pytest** für API-Endpunkte
- **Testabdeckung** für Kernfunktionen

#### Frontend
- **Jest** + **React Testing Library** für Komponenten
- **E2E-Tests** mit Cypress/Playwright (optional)

---

### 7. Dokumentation

Die **README.md** muss enthalten:

1. **Projektübersicht**
   - Was ist mdo-web?
   - Features
   - Technologie-Stack

2. **Lokale Entwicklung**
   - Voraussetzungen
   - Setup
   - Docker-Compose

3. **Produktion-Deployment**
   - Backend (Railway)
   - Frontend (Vercel)
   - Umgebungskonfiguration

4. **API-Dokumentation**
   - Endpunkte
   - Request/Response-Beispiele

5. **Architektur**
   - Backend-Struktur
   - Frontend-Struktur
   - Datenfluss

6. **Beitragen**
   - Code-Stil
   - Testing
   - Pull Requests

7. **Lizenz**
   - MIT (wie mdo-cli)

---

## 🎯 Wichtigste Anforderungen für Claude Code

---

### 1. **Analysiere zuerst den Source-Code!**
   - **Lies und verstehe** diese Dateien aus `mdo-cli`:
     - `src/mdo/core/compiler.py` → **Herzstück der Anwendung**
     - `src/mdo/core/typst_builder.py` → Template-Logik
     - `src/mdo/core/markdown.py` → Markdown → Typst
     - `src/mdo/core/models.py` → Datenmodelle
     - `src/mdo/core/paths.py` → Pfad-Verwaltung
     - `src/mdo/core/server.py` → Bestehender HTTP-Server (Inspiration)

### 2. **DIN 5008 Compliance ist kritisch!**
   - **Layout muss exakt** dem von `mdo-cli` entsprechen
   - **PDF/A-2b Standard** muss verwendet werden (`--pdf-standard a-2b`)
   - **Fonts müssen exakt** sein: Source Serif 4, Source Sans 3, Source Code Pro
   - **Template muss** din5008a v0.1.1 sein

### 3. **Portierungsstrategie**
   - **Wiederverwende so viel Code wie möglich** aus `mdo-cli/src/mdo/core/`
   - **Passe nur die Datei-I/O** an, um in Docker zu funktionieren
   - **Behalte die gleiche Logik** für Markdown → Typst → PDF

### 4. **Code-Qualität**
   - **TypeScript Strict Mode**
   - **Python Type Hints**
   - **Sauberer, gut dokumentierter Code**
   - **Keine hardcoded Pfade** (Umgebungsvariablen verwenden)
   - **Gute Fehlerbehandlung**

### 5. **Lieferumfang**
   - **Komplettes, lauffähiges Projekt**
   - **Docker-Setup** für lokale Entwicklung
   - **Deployment-Anleitung** für Vercel + Railway
   - **Vollständige Dokumentation**

---

## 🚀 Ausführungsbefehl für Claude Code

> **"Analysiere zuerst das Repository https://github.com/jcmx9/mdo-cli, insbesondere die Dateien in `src/mdo/core/`. Erstelle dann das komplette mdo-web Projekt genau wie in diesem Prompt beschrieben. Achte besonders auf:
> 1. DIN 5008 Compliance (exaktes Layout, PDF/A-2b Standard)
> 2. Wiederverwendung der Logik aus mdo-cli
> 3. Komplette Docker-Konfiguration mit allen Abhängigkeiten
> 4. Produktionsfertige Next.js/FastAPI-Anwendung
> 5. Vollständige Dokumentation
>
> Beginne mit der Analyse von mdo-cli und frage nach, falls etwas unklar ist. Generiere dann alle Dateien im korrekten Verzeichnis (`/Users/rolandkreus/GitHub/mdo-service`)."**

---

## 📝 Zusammenfassung

Dieser Prompt enthält **alles**, was Claude Code benötigt, um:
1. ✅ **mdo-cli zu analysieren**
2. ✅ **Die gesamte Funktionalität in eine Web-App zu portieren**
3. ✅ **Backend (FastAPI) + Frontend (Next.js) + Docker zu erstellen**
4. ✅ **DIN 5008 Compliance zu gewährleisten**
5. ✅ **Produktionsfertigen Code zu generieren**

**Ergebnis:** Ein komplett lauffähiges `mdo-service` Projekt in `/Users/rolandkreus/GitHub/mdo-service` mit:
- Backend (FastAPI + Docker)
- Frontend (Next.js + React + TypeScript)
- Alle mdo-cli Funktionen
- Deployment-Ready für Vercel + Railway
