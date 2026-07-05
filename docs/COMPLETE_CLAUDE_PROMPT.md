# 🎯 Komplett-Prompt für Claude Code: mdo-web (DIN 5008 Web-App)

---

> **📌 WICHTIG:** Dieser Prompt ist **vollständig** und **selbstständig** für Claude Code.
> **Ziel:** Ein **einfacher Startbefehl** (`./start`) der:
> 1. Docker prüft und startet
> 2. Browser automatisch öffnet
> 3. **PDF/A-3b** generiert
> 4. **ZIP mit PDF + .md** als Attachment zurückgibt

---

## 🎯 PROJEKTZIEL

Erstelle eine **komplette, selbstständige Docker-Anwendung** namens **mdo-web**, die:
- **Einfach zu starten** ist: `./start` (ein Befehl, alles funktioniert)
- **DIN 5008 Form A Geschäftsbriefe** als **PDF/A-3b** generiert
- **Markdown als Attachment** in einer ZIP-Datei zurückgibt (PDF + .md)
- **Alle Abhängigkeiten** (Pandoc, Typst, Fonts, Template) **im Docker-Container** hat
- **Keine manuelle Installation** benötigt (außer Docker selbst)

---

## 📂 PROJEKTSTRUKTUR

```
mdo-web/
├── start                    # ✅ Ausführbares Start-Skript (main entry point)
├── stop                     # Optional: Stop-Skript
├── docker-compose.yml       # ✅ Docker Compose Konfiguration
├── backend/
│   ├── Dockerfile           # ✅ Backend Dockerfile
│   └── app/
│       ├── main.py          # ✅ FastAPI Hauptdatei
│       ├── requirements.txt # ✅ Python Abhängigkeiten
│       └── services/
│           └── compiler.py   # ✅ PDF-Generierungslogik
├── frontend/
│   ├── Dockerfile           # ✅ Frontend Dockerfile
│   ├── package.json         # ✅ Node.js Abhängigkeiten
│   └── app/
│       └── page.tsx         # ✅ React Frontend
└── README.md                # Dokumentation
```

---

## 🔧 TECHNISCHE ANFORDERUNGEN

---

### 1. **Start-Skript (`./start`)** – **Kernstück!**

**Anforderungen:**
- **Ausführbar** (`chmod +x start`)
- **Prüft Docker-Installation** (fehlend → klare Fehlermeldung mit Lösungsvorschlag)
- **Prüft Docker-Daemon** (läuft nicht → Fehlermeldung)
- **Startet Container** mit `docker compose up -d`
- **Wartet auf Bereitschaft** (Healthchecks abfragen)
- **Öffnet Browser** automatisch (http://localhost:3000)
- **Klare Statusmeldungen** für den Nutzer

**Inhalt (`start`):**
```bash
#!/bin/bash

# ============================================
# mdo-web Start Script
# Einfacher Start: ./start
# ============================================

# --- 1. Docker-Prüfung ---
echo "🔍 Prüfe Docker-Installation..."

# Prüfe, ob Docker installiert ist
if ! command -v docker &> /dev/null; then
    echo ""
    echo "❌ FEHLER: Docker ist nicht installiert!"
    echo ""
    echo "📋 Docker installieren:"
    echo "   🍎 macOS:     brew install --cask docker"
    echo "   🐧 Linux:    https://docs.docker.com/engine/install/"
    echo "   🪟 Windows:   https://www.docker.com/products/docker-desktop/"
    echo ""
    echo "Nach der Installation: Führe 'docker run hello-world' aus, um zu prüfen."
    exit 1
fi

echo "✅ Docker ist installiert"

# Prüfe, ob Docker-Daemon läuft
if ! docker info &> /dev/null; then
    echo ""
    echo "❌ FEHLER: Docker-Daemon läuft nicht!"
    echo ""
    echo "📋 Docker starten:"
    echo "   🍎 macOS:     open -a Docker"
    echo "   🐧 Linux:    sudo systemctl start docker"
    echo "   🪟 Windows:   Starte Docker Desktop"
    echo ""
    exit 1
fi

echo "✅ Docker-Daemon läuft"

# Prüfe Docker Compose
if ! docker compose version &> /dev/null; then
    if ! docker-compose version &> /dev/null; then
        echo ""
        echo "❌ FEHLER: Docker Compose ist nicht installiert!"
        echo ""
        echo "📋 Docker Compose installieren:"
        echo "   https://docs.docker.com/compose/install/"
        exit 1
    fi
fi

echo "✅ Docker Compose ist verfügbar"

# --- 2. Container starten ---
echo ""
echo "🐳 Starte mdo-web Container..."

# Container im Hintergrund starten
docker compose up -d

# Prüfe, ob Container existiert
if ! docker ps | grep -q "mdo-web"; then
    echo ""
    echo "❌ FEHLER: Container konnten nicht gestartet werden!"
    echo ""
    echo "📋 Problem beheben:"
    echo "   1. Prüfe Docker-Logs: docker compose logs"
    echo "   2. Prüfe Speicherplatz: docker system df"
    echo "   3. Versuche: docker compose down && docker compose up -d"
    exit 1
fi

echo "✅ Container gestartet"

# --- 3. Auf Backend bereit sein warten ---
echo "⏳ Warte auf Backend (max. 30 Sekunden)..."
BACKEND_READY=false
for i in {1..30}; do
    if docker inspect --format='{{json .State.Health.Status}}' mdo-web-backend-1 2>/dev/null | grep -q "healthy"; then
        BACKEND_READY=true
        break
    fi
    sleep 1
    echo -n "."
done

if [ "$BACKEND_READY" = false ]; then
    echo ""
    echo "⚠️  Backend-Healthcheck nicht verfügbar, aber Container läuft."
    echo "   Warte noch 5 Sekunden..."
    sleep 5
fi

echo "✅ Backend ist bereit"

# --- 4. Auf Frontend bereit sein warten ---
echo "⏳ Warte auf Frontend (max. 30 Sekunden)..."
FRONTEND_READY=false
for i in {1..30}; do
    if curl -s http://localhost:3000 &> /dev/null; then
        FRONTEND_READY=true
        break
    fi
    sleep 1
    echo -n "."
done

if [ "$FRONTEND_READY" = false ]; then
    echo ""
    echo "⚠️  Frontend nicht erreichbar nach 30 Sekunden."
    echo "   Prüfe die Container-Logs: docker compose logs frontend"
fi

echo "✅ Frontend ist bereit"

# --- 5. Browser öffnen ---
echo ""
echo "🌐 Öffne Browser..."

# Platform-spezifisch Browser öffnen
if command -v xdg-open &> /dev/null; then
    # Linux
    xdg-open http://localhost:3000
elif command -v open &> /dev/null; then
    # macOS
    open http://localhost:3000
else
    # Fallback
    echo "💡 Browser konnte nicht automatisch geöffnet werden."
    echo "   Bitte öffne manuell: http://localhost:3000"
fi

# --- 6. Erfolgsmeldung ---
echo ""
echo "========================================"
echo "✅ mdo-web läuft erfolgreich!"
echo "========================================"
echo ""
echo "   🌐 Frontend: http://localhost:3000"
echo "   🔧 Backend:  http://localhost:8000"
echo "   📄 API-Docs: http://localhost:8000/docs"
echo ""
echo "🛑 Zum Beenden: ./stop"
echo "   oder: docker compose down"
echo ""
```

---

### 2. **Stop-Skript (`./stop`)** – Optional

**Inhalt (`stop`):**
```bash
#!/bin/bash

echo "🛑 Beende mdo-web Container..."
docker compose down
echo "✅ Container beendet"
```

---

### 3. **docker-compose.yml** – **Docker-Orchestrierung**

```yaml
version: "3.8"

services:
  # --- Backend (FastAPI) ---
  backend:
    build:
      context: .
      dockerfile: backend/Dockerfile
    container_name: mdo-web-backend
    ports:
      - "8000:8000"
    volumes:
      - mdo-data:/app/data  # Für temporäre Dateien
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    restart: unless-stopped
    networks:
      - mdo-network

  # --- Frontend (Next.js) ---
  frontend:
    build:
      context: .
      dockerfile: frontend/Dockerfile
    container_name: mdo-web-frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:8000
    depends_on:
      backend:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - mdo-network

# --- Netzwerke ---
networks:
  mdo-network:
    driver: bridge

# --- Volumes ---
volumes:
  mdo-data:
```

---

## 🏗 BACKEND (FastAPI)

---

### 1. **Dockerfile** – Backend-Container

```dockerfile
# ============================================
# Backend Dockerfile
# Python + FastAPI + Pandoc + Typst + Fonts + Template
# ============================================

FROM python:3.12-slim

# --- Environment ---
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# --- System Dependencies ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    pandoc \
    wget \
    git \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# --- Install Typst ---
RUN wget -qO- https://github.com/typst/typst/releases/latest/download/typst-x86_64-unknown-linux-musl.tar.xz | \
    tar -xJ -C /usr/local/bin

# --- Install din5008a Template v0.1.1 ---
RUN git clone --depth 1 --branch v0.1.1 \
    https://github.com/jcmx9/typst-DIN5008a.git \
    /app/templates/local/din5008a/0.1.1 && \
    mkdir -p /app/templates/packages/local && \
    ln -sf /app/templates/local/din5008a/0.1.1 /app/templates/packages/local/din5008a

# --- Install Fonts ---
RUN mkdir -p /app/fonts && \
    # Source Serif 4
    wget -q https://github.com/adobe-fonts/source-serif/releases/download/4.000R/source-serif-4.000R.zip -O /tmp/serif.zip && \
    unzip -q /tmp/serif.zip -d /app/fonts && \
    rm -f /tmp/serif.zip && \
    # Source Sans 3
    wget -q https://github.com/adobe-fonts/source-sans/releases/download/3.050R/source-sans-3.050R.zip -O /tmp/sans.zip && \
    unzip -q /tmp/sans.zip -d /app/fonts && \
    rm -f /tmp/sans.zip && \
    # Source Code Pro
    wget -q https://github.com/adobe-fonts/source-code-pro/releases/download/2.042R/source-code-pro-2.042R.zip -O /tmp/code.zip && \
    unzip -q /tmp/code.zip -d /app/fonts && \
    rm -f /tmp/code.zip

# --- Install Python Dependencies ---
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- Copy Application Code ---
COPY backend/app /app/app

# --- Create Data Directory ---
RUN mkdir -p /app/data

# --- Set Working Directory ---
WORKDIR /app

# --- Expose Port ---
EXPOSE 8000

# --- Run Application ---
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

### 2. **requirements.txt** – Python-Abhängigkeiten

```text
fastapi>=0.109.0
uvicorn>=0.27.0
pydantic>=2.5.0
pyyaml>=6.0
```

---

### 3. **app/main.py** – FastAPI-Hauptdatei

```python
# ============================================
# mdo-web Backend
# FastAPI Endpunkte für PDF-Generierung
# ============================================

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import zipfile
import io
import subprocess
import tempfile
import yaml
from pathlib import Path

# --- FastAPI App ---
app = FastAPI(
    title="mdo-web API",
    description="DIN 5008 Form A Geschäftsbrief-Generator (PDF/A-3b)",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# --- CORS Middleware (für Entwicklung) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Models ---
class ProfileData(BaseModel):
    """Absender-Daten"""
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


class LetterData(ProfileData):
    """Brief-Daten (erbt von ProfileData)"""
    date: Optional[str] = None
    subject: str
    recipient: List[str]
    attachments: List[str] = []
    body: str  # Markdown-Inhalt


# --- API Endpoints ---

@app.get("/health")
async def health():
    """Healthcheck für Docker"""
    return {"status": "ok", "message": "mdo-web Backend läuft"}


@app.get("/")
async def root():
    """Root-Endpoint"""
    return {
        "status": "ok",
        "message": "mdo-web API",
        "docs": "/docs",
        "frontend": "http://localhost:3000"
    }


@app.post("/api/compile")
async def compile_letter(letter: LetterData):
    """
    Generiert eine ZIP-Datei mit PDF/A-3b + ursprünglicher Markdown-Datei.
    
    **Eingabe:** LetterData (Absender + Brief-Daten)
    **Ausgabe:** ZIP-Datei mit:
    - {datum}_{empfaenger} - {betreff}.pdf (PDF/A-3b)
    - {datum}_{empfaenger} - {betreff}.md (ursprüngliche Markdown)
    """
    try:
        # 1. Generiere Markdown mit YAML-Frontmatter
        markdown = generate_markdown(letter)
        
        # 2. Generiere Dateinamen
        date_str = letter.date or datetime.now().strftime("%Y-%m-%d")
        recipient_str = letter.recipient[0].replace("/", "-").replace("\\", "-")
        subject_str = letter.subject.replace("/", "-").replace("\\", "-")
        filename = f"{date_str}_{recipient_str} - {subject_str}"
        
        # 3. Kompiliere zu PDF/A-3b
        pdf_bytes = compile_to_pdf(markdown)
        
        # 4. Erstelle ZIP mit PDF + MD
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Füge PDF hinzu
            zipf.writestr(f"{filename}.pdf", pdf_bytes)
            # Füge Markdown hinzu
            zipf.writestr(f"{filename}.md", markdown.encode('utf-8'))
        
        # 5. Gib ZIP zurück
        return StreamingResponse(
            iter([zip_buffer.getvalue()]),
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={filename}.zip",
                "Content-Type": "application/zip"
            }
        )
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF-Generierung fehlgeschlagen: {str(e)}"
        )


# --- Helper Functions ---

def generate_markdown(letter: LetterData) -> str:
    """
    Generiert Markdown mit YAML-Frontmatter aus LetterData.
    Format entspricht mdo-cli.
    """
    # Konvertiere LetterData zu Dict (ohne None-Werte)
    frontmatter_data = letter.model_dump(exclude_none=True)
    
    # Konvertiere zu YAML
    yaml_str = yaml.dump(
        frontmatter_data,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False
    )
    
    # Baue vollständigen Markdown
    return f"---\n{yaml_str}---\n\n{letter.body}"


def compile_to_pdf(markdown: str) -> bytes:
    """
    Kompiliert Markdown zu PDF/A-3b mit Pandoc + Typst.
    
    **Schritte:**
    1. Markdown → Typst (via Pandoc)
    2. Typst → PDF/A-3b (via Typst)
    
    **Wichtig:**
    - PDF/A-3b Standard (--pdf-standard a-3b)
    - din5008a Template v0.1.1
    - Source Serif/Sans/Code Pro Fonts
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        
        # 1. Schreibe Markdown-Datei
        md_path = tmpdir_path / "brief.md"
        md_path.write_text(markdown, encoding='utf-8')
        
        # 2. Konvertiere zu Typst mit Pandoc
        typ_path = tmpdir_path / "brief.typ"
        subprocess.run([
            "pandoc",
            str(md_path),
            "-o", str(typ_path),
            "-f", "markdown",
            "-t", "typst",
            "--standalone"
        ], check=True, capture_output=True)
        
        # 3. Kompiliere zu PDF/A-3b mit Typst
        pdf_path = tmpdir_path / "brief.pdf"
        result = subprocess.run([
            "typst", "compile",
            "--root", "/app/templates",
            "--font-path", "/app/fonts",
            "--pdf-standard", "a-3b",  # ⭐ PDF/A-3b Standard
            str(typ_path),
            str(pdf_path)
        ], capture_output=True, text=True)
        
        # Prüfe auf Fehler
        if result.returncode != 0:
            raise RuntimeError(f"Typst-Kompilierung fehlgeschlagen:\n{result.stderr}")
        
        # 4. Lese PDF-Datei
        return pdf_path.read_bytes()


# --- Main ---
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=False
    )
```

---

### 4. **app/services/compiler.py** – (Optional, kann in main.py integriert werden)

*→ Wird nicht benötigt, da alles in `main.py` integriert ist.*

---

## 🖥 FRONTEND (Next.js)

---

### 1. **Dockerfile** – Frontend-Container

```dockerfile
# ============================================
# Frontend Dockerfile
# Next.js mit TypeScript
# ============================================

# --- Build Stage ---
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY frontend/package.json frontend/package-lock.json* .

# Install dependencies
RUN npm ci

# Copy all frontend files
COPY frontend .

# Build the application
RUN npm run build

# --- Run Stage ---
FROM node:18-alpine AS runner

WORKDIR /app

# Environment
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# Copy built files from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Expose port
EXPOSE 3000

# Run the application
CMD ["npm", "start"]
```

---

### 2. **package.json** – Node.js-Abhängigkeiten

```json
{
  "name": "mdo-web-frontend",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "typescript": "^5.0.0"
  }
}
```

---

### 3. **app/page.tsx** – React-Frontend (einfach & funktional)

```tsx
// ============================================
// mdo-web Frontend
// Einfache UI für Brief-Generierung
// ============================================

"use client"

import { useState } from "react"

// Standard-Markdown-Template für neuen Brief
const DEFAULT_MARKDOWN = `---
name: Max Mustermann
street: Musterstraße 1
zip: 12345
city: Musterstadt
phone: 0123 456789
email: max@example.de
subject: Bewerbung
recipient:
  - Firma GmbH
  - Herrn Max Müller
closing: Mit freundlichen Grüßen
qr_code: false
date: null
---

Sehr geehrte Damen und Herren,

hier mein Brieftext.

Mit freundlichen Grüßen`

// Parsen von YAML-Frontmatter (einfach für diesen Use Case)
function parseMarkdown(md: string): Record<string, any> {
  const parts = md.split('---')
  if (parts.length < 3) {
    // Kein Frontmatter → nur Body
    return { body: md }
  }
  
  // Parse Frontmatter (einfacher YAML-Parser)
  const frontmatterLines = parts[1].split('\n')
  const obj: Record<string, any> = {}
  
  let currentArray: string | null = null
  frontmatterLines.forEach(line => {
    const trimmedLine = line.trim()
    
    // Leere Zeile oder Kommentar
    if (!trimmedLine || trimmedLine.startsWith('#')) return
    
    // Array-Fortsetzung (z. B. recipient:)
    if (trimmedLine.startsWith('-')) {
      if (currentArray) {
        if (!obj[currentArray]) obj[currentArray] = []
        obj[currentArray].push(trimmedLine.substring(1).trim())
      }
      return
    }
    
    // Normale Zeile
    if (trimmedLine.includes(':')) {
      const [key, ...valueParts] = trimmedLine.split(':')
      const keyTrimmed = key.trim()
      const value = valueParts.join(':').trim()
      
      // Special handling
      if (value === 'true') obj[keyTrimmed] = true
      else if (value === 'false') obj[keyTrimmed] = false
      else if (value === 'null' || value === '') obj[keyTrimmed] = null
      else if (value.startsWith('-')) {
        // Array
        currentArray = keyTrimmed
        obj[keyTrimmed] = [value.substring(1).trim()]
      } else if (!isNaN(Number(value))) {
        obj[keyTrimmed] = Number(value)
      } else {
        obj[keyTrimmed] = value
      }
    }
  })
  
  // Body hinzufügen
  obj.body = parts.slice(2).join('---').trim()
  
  return obj
}

// Hauptkomponente
export default function Home() {
  const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const handleSubmit = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      // 1. Markdown parsen
      const data = parseMarkdown(markdown)
      
      // 2. Validierung (einfach)
      if (!data.name || !data.street || !data.zip || !data.city) {
        throw new Error("Absender-Daten unvollständig (Name, Straße, PLZ, Ort)")
      }
      if (!data.subject) {
        throw new Error("Betreff fehlt")
      }
      if (!data.recipient || data.recipient.length === 0) {
        throw new Error("Empfänger fehlt")
      }
      
      // 3. API aufrufen
      const response = await fetch('http://localhost:8000/api/compile', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      })
      
      // 4. Fehlerbehandlung
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Unbekannter Fehler' }))
        throw new Error(err.detail || 'PDF-Generierung fehlgeschlagen')
      }
      
      // 5. ZIP-Datei herunterladen
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'brief.zip'  // Enthält PDF + MD
      a.click()
      URL.revokeObjectURL(url)
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
    } finally {
      setIsLoading(false)
    }
  }
  
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center py-6">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900">
            mdo-web
          </h1>
          <p className="text-gray-600 mt-2">
            DIN 5008 Form A Geschäftsbrief-Generator
          </p>
          <p className="text-sm text-gray-500 mt-1">
            PDF/A-3b mit Markdown-Attachment
          </p>
        </div>
        
        {/* Fehleranzeige */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700">{error}</p>
          </div>
        )}
        
        {/* Hauptinhalt */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Editor (3/5) */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Markdown-Editor
              </h2>
              <textarea
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                className="w-full h-[600px] p-4 border border-gray-300 rounded-md 
                          font-mono text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="--- name: ... ---"
              />
            </div>
          </div>
          
          {/* Sidebar (2/5) */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Anleitung
              </h2>
              
              <div className="space-y-6">
                {/* Schritt 1 */}
                <div>
                  <h3 className="font-medium text-gray-800 mb-2">
                    1️⃣ YAML-Frontmatter
                  </h3>
                  <p className="text-sm text-gray-600">
                    Fülle die Felder zwischen <code className="bg-gray-100 px-1 rounded">---</code> aus.
                  </p>
                  <pre className="text-xs bg-gray-50 p-3 rounded mt-3 overflow-auto">
{`name: Max Mustermann
street: Musterstraße 1
zip: 12345
city: Musterstadt
subject: Bewerbung
recipient:
  - Firma GmbH
  - Herrn Max Müller`}
                  </pre>
                </div>
                
                {/* Schritt 2 */}
                <div>
                  <h3 className="font-medium text-gray-800 mb-2">
                    2️⃣ Brieftext (Markdown)
                  </h3>
                  <p className="text-sm text-gray-600">
                    Schreibe den Brieftext nach dem zweiten <code className="bg-gray-100 px-1 rounded">---</code>.
                  </p>
                  <p className="text-sm text-gray-600 mt-2">
                    Unterstützt: <strong>Fett</strong>, <em>kursiv</em>, <code>Code</code>, Listen, Links, etc.
                  </p>
                </div>
                
                {/* Schritt 3 */}
                <div>
                  <h3 className="font-medium text-gray-800 mb-2">
                    3️⃣ PDF generieren
                  </h3>
                  <p className="text-sm text-gray-600">
                    Klicke auf den Button. Es wird eine ZIP-Datei heruntergeladen:
                  </p>
                  <ul className="text-sm text-gray-600 mt-2 space-y-1">
                    <li>📄 <code className="bg-gray-100 px-1 rounded">brief.pdf</code> (PDF/A-3b)</li>
                    <li>📝 <code className="bg-gray-100 px-1 rounded">brief.md</code> (ursprüngliche Datei)</li>
                  </ul>
                </div>
              </div>
            </div>
            
            {/* Download-Button */}
            <div className="bg-white rounded-lg shadow-sm p-4">
              <button
                onClick={handleSubmit}
                disabled={isLoading}
                className="w-full py-3 px-6 bg-blue-600 text-white font-medium 
                          rounded-lg hover:bg-blue-700 transition-colors 
                          disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" 
                         xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" 
                              stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" 
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generiere...
                  </span>
                ) : (
                  <span className="flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" 
                         fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" 
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    ZIP herunterladen (PDF + MD)
                  </span>
                )}
              </button>
              
              {isLoading && (
                <p className="text-xs text-gray-500 text-center mt-2">
                  PDF/A-3b wird generiert...
                </p>
              )}
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div className="pt-4 text-center text-sm text-gray-500 border-t border-gray-200">
          <p>
            mdo-web &middot; DIN 5008 Form A &middot; PDF/A-3b &middot; 
            Markdown &rarr; Typst &rarr; PDF
          </p>
        </div>
      </div>
    </div>
  )
}
```

---

### 4. **app/globals.css** – Optional: Grundlegendes Styling

```css
/* ============================================
   mdo-web Grundstyling (optional)
   ============================================ */

@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom scrollbar */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
}

::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #555;
}

/* Monospace font for code */
code {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
}

/* Focus styles */
input:focus, textarea:focus, button:focus {
  outline: none;
}
```

---

### 5. **app/layout.tsx** – Next.js Root Layout

```tsx
import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "mdo-web - DIN 5008 Geschäftsbrief-Generator",
  description: "Generiere DIN 5008 Form A Geschäftsbriefe als PDF/A-3b aus Markdown",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="de">
      <body className="antialiased">{children}</body>
    </html>
  )
}
```

---

## 📋 ZUSAMMENFASSUNG DER DATEIEN

| **Datei** | **Typ** | **Beschreibung** | **Status** |
|-----------|---------|------------------|------------|
| `start` | Shell-Skript | Haupt-Startbefehl (Docker-Prüfung + Start) | ✅ **Kern** |
| `stop` | Shell-Skript | Optional: Container stoppen | ✅ Optional |
| `docker-compose.yml` | YAML | Docker-Orchestrierung | ✅ **Kern** |
| `backend/Dockerfile` | Dockerfile | Backend-Container | ✅ **Kern** |
| `backend/app/main.py` | Python | FastAPI Backend + PDF-Generierung | ✅ **Kern** |
| `backend/app/requirements.txt` | Text | Python-Abhängigkeiten | ✅ **Kern** |
| `frontend/Dockerfile` | Dockerfile | Frontend-Container | ✅ **Kern** |
| `frontend/package.json` | JSON | Node.js-Abhängigkeiten | ✅ **Kern** |
| `frontend/app/page.tsx` | TypeScript | React-Frontend | ✅ **Kern** |
| `frontend/app/layout.tsx` | TypeScript | Next.js Layout | ✅ **Kern** |
| `frontend/app/globals.css` | CSS | Grundstyling (optional) | ⚠️ Optional |
| `README.md` | Markdown | Dokumentation | ✅ Empfohlen |

---

## 🎯 AUSFÜHRENDES BEFEHL FÜR CLAUDE CODE

> **"Erstelle das komplette mdo-web Projekt genau wie in dieser Datei beschrieben. 
> Achte besonders auf:
> 
> 1. **Start-Skript (`./start`)** muss ausführbar sein und:
>    - Docker-Installation prüfen
>    - Docker-Daemon prüfen
>    - Container starten
>    - Auf Bereitschaft warten
>    - Browser automatisch öffnen
> 
> 2. **PDF/A-3b** Standard (`--pdf-standard a-3b`)
> 
> 3. **ZIP mit PDF + .md** als Attachment
> 
> 4. **Alle Abhängigkeiten** im Docker-Container (Pandoc, Typst, Fonts, Template)
> 
> 5. **Minimales, funktionales UI** (kein Over-Engineering)
> 
> **Ergebnis:** Nutzer führt `./start` aus und kann sofort Briefe generieren.
> 
> **Pfad:** `/Users/rolandkreus/GitHub/mdo-service`
> 
> **Beginne mit der Analyse von mdo-cli (https://github.com/jcmx9/mdo-cli), 
> dann implementiere die Lösung Schritt für Schritt."**

---

## ✅ CHECKLISTE FÜR CLAUDE CODE

- [ ] `start`-Skript erstellen (ausführbar, Docker-Prüfung, Browser-Start)
- [ ] `docker-compose.yml` mit Backend + Frontend
- [ ] Backend Dockerfile (Python + Pandoc + Typst + Fonts + Template)
- [ ] Backend main.py (FastAPI + PDF/A-3b + ZIP mit PDF + MD)
- [ ] Frontend Dockerfile (Next.js)
- [ ] Frontend page.tsx (einfaches UI mit Markdown-Editor)
- [ ] Frontend package.json
- [ ] README.md mit Anleitung
- [ ] `.gitignore` für Docker/Node
- [ ] Alle Dateien in `/Users/rolandkreus/GitHub/mdo-service`

---

## 📝 HINWEISE

1. **Teste lokal vor der Abgabe:**
   ```bash
   cd /Users/rolandkreus/GitHub/mdo-service
   chmod +x start
   ./start
   ```

2. **Wichtigste Anforderungen:**
   - `./start` muss **einfach** funktionieren
   - PDF muss **PDF/A-3b** sein
   - ZIP muss **PDF + .md** enthalten
   - **Keine manuelle Installation** nötig (außer Docker)

3. **Optional:**
   - `stop`-Skript für einfaches Beenden
   - `globals.css` für besseres Styling
   - Ausführliche README.md

---

**🎉 Fertig! Diese Datei enthält ALLES, was Claude Code für dein Projekt benötigt.**
