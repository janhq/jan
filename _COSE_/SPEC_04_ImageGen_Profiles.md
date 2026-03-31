# TASK: Aggiungere Image Generation (Cloud API) a Jan Desktop

## Contesto

Jan è un'app desktop AI (Tauri + React/TypeScript). Stiamo aggiungendo la
generazione di immagini tramite API cloud. L'utente configura una API key
e può chiedere al modello di generare immagini nella chat.

---

## Obiettivo

L'utente scrive nella chat qualcosa come "genera un'immagine di un tramonto
sul mare". Il modello riconosce l'intent e invoca la generazione. L'immagine
appare inline nella chat e nel pannello Artifact.

---

## Provider supportati

### 1. OpenAI DALL-E (priorità alta)

```
POST https://api.openai.com/v1/images/generations
Headers:
  Authorization: Bearer <OPENAI_API_KEY>
  Content-Type: application/json
Body:
{
  "model": "dall-e-3",
  "prompt": "A sunset over the ocean, photorealistic",
  "n": 1,
  "size": "1024x1024",
  "quality": "standard",
  "response_format": "b64_json"
}

Risposta:
{
  "data": [
    {
      "b64_json": "<base64 dell'immagine PNG>",
      "revised_prompt": "Il prompt rivisto da DALL-E"
    }
  ]
}
```

Sizes disponibili: `1024x1024`, `1024x1792`, `1792x1024`
Quality: `standard` (più veloce) o `hd` (più dettagliato)

### 2. Stability AI (priorità media)

```
POST https://api.stability.ai/v2beta/stable-image/generate/sd3
Headers:
  Authorization: Bearer <STABILITY_API_KEY>
  Content-Type: multipart/form-data
Body (form-data):
  prompt: "A sunset over the ocean"
  output_format: "png"
  aspect_ratio: "1:1"

Risposta: immagine binaria direttamente nel body (content-type: image/png)
```

### 3. Replicate (priorità bassa, futuro)

Più complesso (asincrono con polling), aggiungere solo se richiesto.

---

## Architettura — Due approcci

### Approccio A: Rilevamento pattern nel messaggio (semplice)

1. Il modello genera un blocco speciale nella risposta, es:
   ```
   [GENERATE_IMAGE]
   prompt: "A beautiful sunset over the ocean, photorealistic, warm colors"
   size: "1024x1024"
   [/GENERATE_IMAGE]
   ```

2. Il frontend rileva questo pattern e chiama l'API configurata

3. L'immagine viene inserita nel messaggio al posto del blocco

**Problema:** richiede che il modello conosca il formato del blocco.
Funziona bene solo se il system prompt lo istruisce.

### Approccio B: Tool calling / Function calling (migliore)

Se il modello supporta tool calling (Qwen, gpt-oss, Llama con tools),
definire un tool:

```json
{
  "type": "function",
  "function": {
    "name": "generate_image",
    "description": "Generate an image from a text description. Use when the user explicitly asks to create, draw, or generate an image.",
    "parameters": {
      "type": "object",
      "properties": {
        "prompt": {
          "type": "string",
          "description": "Detailed description of the image to generate in English"
        },
        "size": {
          "type": "string",
          "enum": ["1024x1024", "1024x1792", "1792x1024"],
          "description": "Image dimensions"
        }
      },
      "required": ["prompt"]
    }
  }
}
```

Il modello invoca il tool → il frontend esegue la chiamata API → il risultato
viene mostrato nella chat.

**Usa Approccio B se Jan supporta già tool calling.** Altrimenti Approccio A.

---

## UI — Impostazioni

Nella pagina Settings, aggiungere una sezione "Image Generation":

```
┌─────────────────────────────────────────────┐
│  🖼️ Image Generation                        │
│                                             │
│  Provider: [OpenAI DALL-E ▾]                │
│                                             │
│  API Key:  [sk-xxxxxxxxxxxxxxxx______]      │
│            [Get API Key →]                  │
│                                             │
│  Default size:  [1024x1024 ▾]               │
│  Default quality: [Standard ▾]              │
│                                             │
│  Status: ● Configurato                      │
└─────────────────────────────────────────────┘
```

Se l'utente ha già configurato un provider OpenAI per la chat, l'API key
potrebbe essere la stessa — offrire un toggle "Usa la stessa API key di OpenAI".

---

## UI — Rendering nella chat

Quando l'immagine viene generata:

```
┌─────────────────────────────────────────────┐
│ 🤖 Ecco l'immagine che hai richiesto:       │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │                                         │ │
│ │         [Immagine generata]             │ │
│ │         1024x1024 px                    │ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ Prompt usato: "A sunset over the ocean..."  │
│                                             │
│ [⬇ Download] [🔄 Rigenera] [✏️ Modifica]   │
└─────────────────────────────────────────────┘
```

- **Download**: salva come PNG
- **Rigenera**: stessa prompt, nuovo seed
- **Modifica**: apre un input per modificare la prompt e rigenerare

L'immagine viene anche mostrata nel pannello Artifact (se implementato).

---

## Gestione errori

- API key non configurata → "Configura un provider di generazione immagini in Settings"
- API key invalida → "API key non valida. Verifica la configurazione."
- Rate limit → "Limite raggiunto. Riprova tra qualche minuto."
- Contenuto bloccato (safety filter) → "Il provider ha bloccato questa richiesta per
  motivi di sicurezza. Prova con una prompt diversa."

---

## Test

- [ ] Configurazione API key OpenAI nelle settings
- [ ] Richiesta "genera un'immagine di un gatto" → immagine inline
- [ ] Download immagine → salva PNG
- [ ] Rigenera → nuova immagine, stessa prompt
- [ ] API key mancante → messaggio chiaro
- [ ] API key invalida → errore chiaro
- [ ] Safety filter triggered → messaggio appropriato
- [ ] Immagine appare anche nel pannello Artifact

---
---

# TASK: Aggiungere Profili Utente a Jan Desktop

## Contesto

Jan è un'app desktop single-user. Vogliamo aggiungere la possibilità di avere
**profili separati**, ciascuno con la propria cronologia chat, impostazioni
e configurazione provider. Non è multi-user con autenticazione — sono profili
locali sullo stesso PC.

---

## Obiettivo

L'utente può creare e switchare tra profili. Ogni profilo ha:
- La propria cronologia chat
- I propri provider configurati (API key separate)
- I propri system prompt e assistenti custom
- Le proprie impostazioni (tema, modello default, etc.)
- I propri MCP servers configurati

---

## Casi d'uso

- **Lavoro vs Personale**: prompt e provider diversi
- **Progetti separati**: un profilo per progetto con contesto dedicato
- **Demo/Test**: profilo pulito per fare demo senza mostrare chat personali
- **Famiglia**: profili separati su un PC condiviso

---

## Architettura

### Directory dati

Jan salva i suoi dati in una directory locale (la "Jan data folder").
I profili si implementano come **sottodirectory separate**.

```
~/.jan/                           (o dovunque Jan salvi i dati)
├── profiles.json                 ← lista profili e profilo attivo
├── profiles/
│   ├── default/                  ← profilo creato automaticamente
│   │   ├── databases/            ← SQLite con chat history
│   │   ├── models/               ← configurazione modelli (condivisa o separata)
│   │   ├── settings.json         ← impostazioni del profilo
│   │   ├── providers.json        ← configurazione provider + API keys
│   │   └── mcp/                  ← configurazione MCP servers
│   ├── lavoro/
│   │   ├── databases/
│   │   ├── settings.json
│   │   ├── providers.json
│   │   └── mcp/
│   └── personale/
│       └── ...
└── models/                       ← modelli scaricati (CONDIVISI tra profili)
```

**I modelli scaricati sono condivisi** tra tutti i profili (occupano GB di spazio).
Solo le configurazioni e le chat sono separate.

### profiles.json

```json
{
  "activeProfile": "default",
  "profiles": [
    {
      "id": "default",
      "name": "Default",
      "icon": "👤",
      "createdAt": "2026-03-31T10:00:00Z"
    },
    {
      "id": "lavoro",
      "name": "Lavoro",
      "icon": "💼",
      "createdAt": "2026-03-31T10:05:00Z"
    }
  ]
}
```

---

## UI

### Selettore profilo nella sidebar

In cima alla sidebar (o in basso vicino alle settings), un selettore profilo:

```
┌──────────────────────┐
│ 👤 Default        ▾  │  ← Click apre dropdown
├──────────────────────┤
│ 👤 Default        ✓  │
│ 💼 Lavoro            │
│ 🏠 Personale         │
│ ─────────────────── │
│ ＋ Nuovo profilo...   │
│ ⚙️ Gestisci profili  │
└──────────────────────┘
```

### Gestione profili (pagina Settings)

```
┌─────────────────────────────────────────────┐
│  👤 Profili                                  │
│                                             │
│  ┌─────────────────────────────────────────┐│
│  │ 👤 Default              [Attivo]        ││
│  │ Creato: 31 Mar 2026 │ 42 chat           ││
│  │ [✏️ Rinomina] [🗑️ Elimina]              ││
│  └─────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────┐│
│  │ 💼 Lavoro                               ││
│  │ Creato: 31 Mar 2026 │ 15 chat           ││
│  │ [✏️ Rinomina] [🗑️ Elimina] [Attiva]     ││
│  └─────────────────────────────────────────┘│
│                                             │
│  [＋ Crea nuovo profilo]                     │
│                                             │
│  ⚠️ I modelli scaricati sono condivisi       │
│     tra tutti i profili.                    │
└─────────────────────────────────────────────┘
```

### Creazione profilo

Dialog modale:
```
┌────────────────────────────────────┐
│  Nuovo Profilo                     │
│                                    │
│  Nome: [_________________]         │
│  Icona: [👤 ▾] (emoji picker)     │
│                                    │
│  ☐ Copia impostazioni dal          │
│    profilo attuale                 │
│                                    │
│  [Annulla]            [Crea]       │
└────────────────────────────────────┘
```

---

## Comportamento

### Switch profilo
1. L'utente seleziona un profilo diverso dal dropdown
2. L'app salva lo stato corrente
3. Cambia la directory dati attiva
4. Ricarica chat history, settings, provider dal nuovo profilo
5. La sidebar mostra le chat del nuovo profilo
6. **Non richiede restart** — lo switch è istantaneo

### Eliminazione profilo
- Chiede conferma: "Eliminare il profilo 'Lavoro'? Tutte le chat e
  impostazioni di questo profilo verranno cancellate. I modelli scaricati
  non verranno toccati."
- Il profilo "Default" non può essere eliminato
- Se il profilo attivo viene eliminato, switcha a "Default"

### Migrazione (primo avvio dopo l'aggiornamento)
- I dati esistenti vengono spostati nel profilo "Default"
- L'utente non perde nulla

---

## Implementazione

### Dove intervenire

1. **Inizializzazione app**: all'avvio, leggi `profiles.json`, carica il profilo attivo
2. **Data layer**: tutti i percorsi file (database, settings, ecc.) devono
   passare per una funzione `getProfileDataPath(filename)` che aggiunge
   il prefisso del profilo attivo
3. **Sidebar**: aggiungere il selettore profilo
4. **Settings**: aggiungere pagina gestione profili
5. **State management**: lo store globale deve sapere qual è il profilo attivo

### Punto critico

Trovare nel codice di Jan DOVE vengono definiti i percorsi della data directory.
Probabilmente c'è una costante o una funzione tipo `getJanDataPath()` o simile.
Quella funzione deve essere modificata per includere il profilo attivo:

```typescript
// PRIMA
function getDataPath(): string {
  return path.join(homedir(), '.jan');
}

// DOPO
function getDataPath(): string {
  const profile = getActiveProfile(); // 'default', 'lavoro', etc.
  return path.join(homedir(), '.jan', 'profiles', profile);
}

// I modelli restano condivisi
function getModelsPath(): string {
  return path.join(homedir(), '.jan', 'models'); // NON dipende dal profilo
}
```

---

## Test

- [ ] Primo avvio dopo update → dati migrati in profilo "Default"
- [ ] Crea nuovo profilo → directory creata, profilo vuoto
- [ ] Crea profilo con copia impostazioni → settings copiate
- [ ] Switch profilo → chat history cambia, settings cambiano
- [ ] Switch profilo → provider e API key cambiano
- [ ] I modelli scaricati sono visibili in tutti i profili
- [ ] Elimina profilo → conferma, directory cancellata
- [ ] Profilo "Default" → non eliminabile
- [ ] Elimina profilo attivo → switch automatico a "Default"
- [ ] Rinomina profilo → aggiornato ovunque
- [ ] Restart app → riapre con l'ultimo profilo attivo
