# TASK: Aggiungere Provider Ollama Nativo a Jan Desktop

## Contesto

Jan è un'app desktop AI (Tauri + React/TypeScript) open source (Apache 2.0).
Repo: https://github.com/janhq/jan

Attualmente Jan NON ha un provider Ollama dedicato. Per usare Ollama, l'utente deve
configurare manualmente il provider OpenAI inserendo `http://localhost:11434/v1` come
Base URL — un workaround scomodo e non documentato nell'app.

## Obiettivo

Aggiungere un **provider "Ollama" first-class** nell'app con due modalità preconfigurate:

1. **Ollama Local** — connessione a un'istanza Ollama in esecuzione sulla macchina
   dell'utente (o sulla rete locale)
2. **Ollama Cloud** — connessione diretta alle API cloud di ollama.com, senza bisogno
   di avere Ollama installato

L'utente deve poter usare entrambe le modalità con il minimo sforzo di configurazione.

---

## Architettura delle API Ollama

Ollama espone due set di API equivalenti:

### API Nativa Ollama
- `GET  /api/tags`       → lista modelli disponibili
- `POST /api/chat`       → chat con streaming
- `POST /api/generate`   → generazione testo (single-turn)
- `POST /api/show`       → dettagli modello
- `GET  /api/ps`         → modelli caricati in memoria
- `GET  /api/version`    → versione server

### API Compatibile OpenAI (già supportata da Jan)
- `GET  /v1/models`              → lista modelli (formato OpenAI)
- `POST /v1/chat/completions`    → chat completions (formato OpenAI)

Entrambi i set funzionano sia in locale che in cloud. La differenza tra locale e cloud è:

| | Ollama Local | Ollama Cloud |
|---|---|---|
| **Host** | `http://localhost:11434` | `https://ollama.com` |
| **Auth** | Nessuna | `Authorization: Bearer <API_KEY>` |
| **Modelli** | Solo quelli installati (`ollama pull ...`) + eventuali cloud se loggato | Tutti i modelli cloud disponibili su ollama.com |
| **Costo** | Gratis (hardware locale) | Piano gratuito con limiti, piani a pagamento |

### Endpoint specifici per il cloud

Per listare i modelli cloud disponibili (non quelli installati localmente):
```
GET https://ollama.com/api/tags
Headers: Authorization: Bearer <API_KEY>
```

Risposta (stessa struttura del locale):
```json
{
  "models": [
    {
      "name": "gpt-oss:120b",
      "model": "gpt-oss:120b",
      "size": 0,
      "details": {
        "format": "...",
        "family": "gpt-oss",
        "parameter_size": "120B",
        "quantization_level": "..."
      }
    }
  ]
}
```

Per chattare con un modello cloud:
```
POST https://ollama.com/api/chat
Headers: 
  Content-Type: application/json
  Authorization: Bearer <API_KEY>
Body:
{
  "model": "gpt-oss:120b",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "stream": true
}
```

Risposta in streaming (una riga JSON per token):
```json
{"model":"gpt-oss:120b","created_at":"...","message":{"role":"assistant","content":"The"},"done":false}
{"model":"gpt-oss:120b","created_at":"...","message":{"role":"assistant","content":" sky"},"done":false}
...
{"model":"gpt-oss:120b","created_at":"...","message":{"role":"assistant","content":""},"done":true,"total_duration":...,"eval_count":...}
```

---

## Approccio di implementazione consigliato

Dato che Jan supporta già provider OpenAI-compatibili, l'approccio più semplice e meno
invasivo è **riutilizzare il meccanismo dei provider OpenAI esistenti**, ma con due
provider pre-configurati e una UI dedicata.

### Opzione A — Due provider precofigurati (CONSIGLIATA, meno invasiva)

Usare il sistema Engine/Provider esistente di Jan per registrare due provider:

#### Provider 1: "Ollama Local"
- Engine Name: `Ollama Local`
- Chat Completions URL: `http://localhost:11434/v1/chat/completions`
- Model List URL: `http://localhost:11434/v1/models`
- API Key: `ollama` (valore fisso, Ollama locale non richiede autenticazione)
- Icona/branding: logo Ollama
- Auto-detect: al primo avvio, verifica se Ollama è raggiungibile su localhost:11434.
  Se sì, abilita automaticamente. Se no, mostra un messaggio con link a ollama.com/download.

#### Provider 2: "Ollama Cloud"
- Engine Name: `Ollama Cloud`
- Chat Completions URL: `https://ollama.com/v1/chat/completions`
- Model List URL: `https://ollama.com/v1/models`
- API Key: `<inserita dall'utente>` — campo obbligatorio
- Icona/branding: logo Ollama + icona cloud
- Link "Get API Key" che apre `https://ollama.com/settings/keys` nel browser

### Opzione B — Provider con API nativa Ollama (più lavoro, migliore UX)

Creare un provider custom che usa le API native di Ollama (`/api/chat`, `/api/tags`)
invece del layer di compatibilità OpenAI. Questo permetterebbe:
- Mostrare info dettagliate sui modelli (parameter_size, quantization_level, famiglia)
- Vedere i modelli caricati in memoria (`/api/ps`)
- Potenzialmente fare pull di modelli dall'app (`/api/pull`) — solo per locale

Questa opzione richiede più codice ma offre un'esperienza migliore.

**La scelta tra A e B dipende da come è strutturato il codice dei provider in Jan.**
Esplora prima la codebase per capire come sono registrati i provider esistenti
(OpenAI, Anthropic, etc.) e scegli l'approccio che si integra meglio.

---

## Cosa fare concretamente

### Step 1 — Esplorare la codebase

Prima di scrivere codice, esplora e comprendi:

1. Come sono definiti i provider esistenti (OpenAI, Anthropic, Mistral).
   Cerca file/directory relativi a "provider", "engine", "model provider".
   Probabile percorso: qualcosa come `src/`, `app/`, o `renderer/` nel frontend.

2. Come viene gestita la lista dei modelli per ciascun provider.

3. Come viene effettuata la chiamata di chat/completions — in quale modulo,
   con quale client HTTP.

4. Dove sono le impostazioni/settings nell'UI — la pagina "Model Providers".

5. Come viene persistita la configurazione dei provider (file JSON? SQLite? localStorage?).

### Step 2 — Aggiungere i provider

Sulla base di ciò che trovi, aggiungi i due provider (Ollama Local e Ollama Cloud).

Per ciascuno:
- Registralo nel sistema dei provider con nome, icona, URL di default
- Aggiungi la voce nella pagina Settings → Model Providers
- Assicurati che i modelli vengano listati correttamente quando l'utente attiva il provider
- Assicurati che la chat funzioni con streaming

### Step 3 — UI nella pagina Settings

Nella sezione Model Providers delle impostazioni, aggiungi una sezione "Ollama" con:

```
┌─────────────────────────────────────────────────────┐
│  🦙 Ollama                                          │
│                                                     │
│  ┌─ Local ────────────────────────────────────────┐ │
│  │ Host: [http://localhost:11434________]          │ │
│  │ Status: ● Connected (3 models available)       │ │
│  │         oppure                                  │ │
│  │ Status: ○ Not connected                        │ │
│  │         [Download Ollama →]                     │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ Cloud ────────────────────────────────────────┐ │
│  │ API Key: [sk-xxxxxxxxxxxxxxxx__________]       │ │
│  │ [Get API Key →]                                │ │
│  │ Status: ● Connected (15 models available)      │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Step 4 — Auto-detect Ollama locale

All'avvio dell'app (o quando l'utente apre Settings), fai una richiesta:

```
GET http://localhost:11434/api/version
```

- Se risponde → Ollama è attivo. Mostra "Connected". Fetch modelli da `/api/tags` o `/v1/models`.
- Se non risponde → Mostra "Not connected" con link al download.
- L'host deve essere modificabile dall'utente (per supportare Ollama su un'altra macchina, es. `http://192.168.1.100:11434`).

### Step 5 — Selezione modello nella chat

Quando l'utente crea una nuova conversazione e seleziona il modello:

- I modelli Ollama Local devono apparire raggruppati sotto "Ollama Local" con le info
  (nome, dimensione parametri, quantizzazione) se disponibili
- I modelli Ollama Cloud devono apparire sotto "Ollama Cloud"
- Se entrambi sono attivi, mostrarli entrambi nei rispettivi gruppi

### Step 6 — Test

Verifica che funzionino:
- [ ] Chat con modello Ollama locale (es. `llama3.2`) — con streaming
- [ ] Chat con modello Ollama Cloud (es. `gpt-oss:120b`) — con streaming
- [ ] Lista modelli locale si aggiorna se l'utente installa/rimuove modelli
- [ ] Lista modelli cloud mostra tutti i modelli disponibili
- [ ] Cambio host locale funziona (es. `http://192.168.1.50:11434`)
- [ ] Errore chiaro se Ollama locale non è raggiungibile
- [ ] Errore chiaro se API key cloud è invalida
- [ ] I modelli vision (llava, gemma3) accettano immagini
- [ ] Multimodale funziona (invio immagini nella chat)

---

## Riferimenti API

### Ollama Native API — Endpoint completi

```
# Verifica connessione
GET http://localhost:11434/api/version
→ {"version": "0.18.2"}

# Lista modelli
GET http://localhost:11434/api/tags
→ {"models": [{"name": "llama3.2", "size": 2147483648, "details": {...}}, ...]}

# Chat (streaming)
POST http://localhost:11434/api/chat
Body: {"model": "llama3.2", "messages": [{"role": "user", "content": "Hi"}], "stream": true}
→ stream di oggetti JSON, uno per riga

# Chat (non-streaming)
POST http://localhost:11434/api/chat
Body: {"model": "llama3.2", "messages": [...], "stream": false}
→ singolo oggetto JSON con risposta completa

# Chat con immagine (multimodale)
POST http://localhost:11434/api/chat
Body: {"model": "llava", "messages": [{"role": "user", "content": "Describe this", "images": ["<base64>"]}]}

# Dettagli modello
POST http://localhost:11434/api/show
Body: {"model": "llama3.2"}
→ {"modelfile": "...", "parameters": "...", "template": "...", "details": {...}}

# Modelli in memoria
GET http://localhost:11434/api/ps
→ {"models": [{"name": "llama3.2", "size": 2147483648, "size_vram": 2147483648, ...}]}
```

### Ollama Cloud API — stessa struttura, host diverso

```
# Stessi endpoint, host diverso, auth richiesta
GET https://ollama.com/api/tags
Headers: Authorization: Bearer <API_KEY>

POST https://ollama.com/api/chat
Headers: Authorization: Bearer <API_KEY>
Body: {"model": "gpt-oss:120b", "messages": [...], "stream": true}
```

### Ollama OpenAI-compatible API (alternativa)

```
# Lista modelli (formato OpenAI)
GET http://localhost:11434/v1/models
→ {"object": "list", "data": [{"id": "llama3.2", "object": "model", ...}]}

# Chat completions (formato OpenAI)
POST http://localhost:11434/v1/chat/completions
Body: {"model": "llama3.2", "messages": [...], "stream": true}
→ formato SSE standard OpenAI (data: {...})

# Cloud equivalente:
GET https://ollama.com/v1/models
Headers: Authorization: Bearer <API_KEY>

POST https://ollama.com/v1/chat/completions  
Headers: Authorization: Bearer <API_KEY>
Body: {"model": "gpt-oss:120b", "messages": [...], "stream": true}
```

---

## Note importanti

- NON stiamo costruendo un nuovo client da zero. Stiamo MODIFICANDO Jan esistente.
- Cerca di essere il meno invasivo possibile — riusa codice e pattern esistenti.
- Se Jan ha un sistema di plugin/engine, usalo. Non reinventare.
- Il provider OpenAI-compatible (`/v1/`) è la via più veloce per far funzionare tutto
  perché Jan lo supporta già. L'API nativa (`/api/`) è migliore ma richiede più lavoro.
- Testa sempre con streaming attivo — è il default di Ollama e dell'UX chat.
