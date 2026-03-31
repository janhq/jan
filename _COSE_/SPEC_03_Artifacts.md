# TASK: Artifacts — Comportamento stile Claude Desktop

## Come funziona su Claude Desktop (il modello da replicare)

Su Claude Desktop, un Artifact non è solo "un pannello che mostra HTML".
È un **oggetto versionato e interattivo** che il modello crea, aggiorna
e a cui può fare riferimento durante tutta la conversazione.

### Comportamento chiave di Claude Desktop

1. **Il modello DECIDE di creare un Artifact** — non è l'utente che clicca
   qualcosa. Quando la risposta è un contenuto "standalone" (un'app HTML, un
   documento, un grafico, un componente), il modello lo wrappa come Artifact
   e appare nel pannello laterale.

2. **Versionamento** — se l'utente dice "cambia il colore in rosso", il modello
   aggiorna l'Artifact esistente. Il pannello mostra la versione aggiornata.
   L'utente può navigare tra le versioni (v1, v2, v3...).

3. **Interattività** — gli Artifact HTML/JS sono completamente interattivi.
   L'utente può cliccare bottoni, compilare form, usare slider — tutto
   funziona nel pannello.

4. **Il pannello si apre automaticamente** — quando il modello genera un
   Artifact, il pannello si apre. Si chiude con [✕] o Escape.

5. **Riferimenti incrociati** — il modello può dire "ho aggiornato l'artifact"
   e il pannello si aggiorna. La chat e il pannello sono sincronizzati.

### Esempio di flusso su Claude Desktop

```
Utente: "Crea un timer Pomodoro in HTML"

Modello: Ecco un timer Pomodoro interattivo.

         [Il pannello laterale si apre automaticamente
          mostrando un timer funzionante con pulsanti
          Start/Stop/Reset]

Utente: "Aggiungi un suono alla fine del timer"

Modello: Ho aggiornato il timer con una notifica sonora.

         [Il pannello si aggiorna con la nuova versione.
          Tab: v1 → v2. L'utente può tornare a v1.]

Utente: "Usa colori dark mode"

Modello: Aggiornato con tema scuro.

         [Pannello aggiornato. Tab: v1 → v2 → v3]
```

---

## Architettura

### Struttura dati Artifact

```typescript
interface Artifact {
  id: string;                 // UUID
  messageId: string;          // Messaggio che l'ha generato
  type: ArtifactType;         // 'html' | 'svg' | 'mermaid' | 'code' | 'markdown' | 'chart'
  title: string;              // Titolo descrittivo
  content: string;            // Contenuto grezzo (HTML, SVG, etc.)
  language?: string;          // Per tipo 'code': 'python', 'javascript', etc.
  version: number;            // 1, 2, 3...
  parentId?: string;          // ID della versione precedente (per versionamento)
  createdAt: string;
}

type ArtifactType = 'html' | 'svg' | 'mermaid' | 'markdown' | 'chart' | 'code' | 'table';
```

### Rilevamento Artifact nella risposta del modello

Il rilevamento avviene analizzando i blocchi di codice nella risposta streaming.

```typescript
function detectArtifact(language: string, content: string): ArtifactType | null {
  // HTML: pagina completa o componente significativo
  if (language === 'html') {
    if (content.includes('<html') || content.includes('<!DOCTYPE') ||
        content.includes('<body') || content.includes('<head') ||
        (content.includes('<div') && content.includes('<script')) ||
        (content.includes('<style') && content.includes('<div')) ||
        content.length > 500)
      return 'html';
  }

  // SVG
  if (language === 'svg' || content.trimStart().startsWith('<svg'))
    return 'svg';

  // Mermaid
  if (language === 'mermaid') return 'mermaid';

  // Non promuovere ad artifact:
  // - Blocchi codice brevi (snippet esplicativi)
  // - Codice Python (gestito dal Code Interpreter)
  // - Blocchi di configurazione (JSON, YAML, TOML brevi)
  return null;
}
```

**Cosa NON diventa Artifact:**
- Blocchi Python → gestiti dal Code Interpreter
- Snippet brevi (< 10 righe) → restano blocchi codice inline
- JSON/YAML di configurazione → restano inline
- Codice esplicativo con commenti → resta inline

**Cosa DIVENTA Artifact:**
- HTML con struttura completa (anche senza `<html>`)
- SVG
- Diagrammi Mermaid
- Output del Code Interpreter (grafici, tabelle)
- Qualsiasi blocco HTML >500 caratteri con JS/CSS

---

## Layout UI — il pannello laterale

### Anatomia del pannello

```
┌────────────────────────────────────────────┐
│ 🔲 Timer Pomodoro              v2  ▾  [✕] │  ← Header con titolo, versione, close
├────────────────────────────────────────────┤
│ [Code]  [Preview]                          │  ← Tab switch
├────────────────────────────────────────────┤
│                                            │
│                                            │
│          AREA DI RENDERING                 │
│                                            │
│    (iframe per HTML / renderer per SVG     │
│     / mermaid / ecc.)                      │
│                                            │
│                                            │
│                                            │
├────────────────────────────────────────────┤
│ [📋 Copia] [⬇ Scarica] [🔗 Apri esternamente] │ ← Toolbar
└────────────────────────────────────────────┘
```

### Tab "Code"

Mostra il codice sorgente dell'artifact con syntax highlighting.
Non editabile (l'utente modifica chiedendo al modello nella chat).

### Tab "Preview" (default)

Renderizza il contenuto:
- **HTML** → iframe sandboxato con contenuto live e interattivo
- **SVG** → rendering diretto con zoom/pan
- **Mermaid** → diagramma renderizzato da mermaid.js
- **Chart** → immagine PNG (da Code Interpreter)
- **Table** → tabella interattiva con sort/filter

### Selettore versione

Se l'artifact ha più versioni (il modello l'ha aggiornato):

```
[v1] [v2] [v3 ●]     ← ● indica la versione corrente
```

Click su una versione precedente mostra quella versione nel pannello.

### Comportamento del pannello

- **Apertura**: automatica quando un artifact viene rilevato
- **Chiusura**: [✕] o Escape. La chat torna full-width.
- **Resize**: bordo sinistro draggable
- **Width default**: 45% della finestra
- **Min width**: 300px pannello, 400px chat
- **Memoria**: se chiuso e riaperto, mostra l'ultimo artifact attivo
- **Multiple artifacts**: se più artifact nella conversazione, il pannello
  mostra l'ultimo. Un indicatore nella chat permette di riaprire artifact precedenti.

### Indicatore artifact nella chat

Quando un messaggio contiene un artifact, nella chat appare un blocco cliccabile:

```
🤖 Ecco il timer Pomodoro che hai chiesto.

   ┌─────────────────────────────────────┐
   │ 🔲 Timer Pomodoro             [👁]  │  ← Click apre/focalizza nel pannello
   │ HTML • v2 • Aggiornato 2 min fa    │
   └─────────────────────────────────────┘

   Ho aggiunto le seguenti funzionalità:
   - Pulsanti Start/Stop/Reset
   - ...
```

Il pulsante [👁] apre il pannello (se chiuso) e mostra quell'artifact.

---

## Rendering per tipo

### HTML → iframe sandbox

```html
<iframe
  sandbox="allow-scripts"
  srcdoc={`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; }
      </style>
    </head>
    <body>
      ${artifactContent}
    </body>
    </html>
  `}
  style="width: 100%; height: 100%; border: none; background: white;"
/>
```

Se l'artifact include già `<html>` e `<head>`, usare il contenuto direttamente
come `srcdoc` senza wrapping.

L'iframe è completamente interattivo (JS funziona) ma isolato dal frame parent.

### SVG → rendering diretto con zoom

```tsx
<div className="svg-container" style={{ overflow: 'auto' }}>
  <div dangerouslySetInnerHTML={{ __html: svgContent }} />
</div>
```

Con wrapper per zoom (scroll wheel) e pan (drag).

### Mermaid → mermaid.js

```typescript
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: isDarkMode ? 'dark' : 'default',
  securityLevel: 'strict',
});

const { svg } = await mermaid.render(`mermaid-${id}`, content);
// Inserire svg nel pannello
```

### Chart da Code Interpreter → immagine con download

```tsx
<div className="chart-container">
  <img
    src={`data:image/png;base64,${base64Image}`}
    alt={title}
    style={{ maxWidth: '100%', height: 'auto' }}
  />
</div>
```

---

## Integrazione con Code Interpreter

Quando il Code Interpreter produce output visuale:

1. **Grafico matplotlib** → diventa Artifact tipo `chart`, si apre nel pannello
2. **Tabella pandas grande** (>10 righe) → diventa Artifact tipo `table`
3. **Testo stdout** → resta inline nella chat, NON diventa artifact

Il Code Interpreter e gli Artifact lavorano insieme:

```
Utente: "Crea un grafico delle vendite mensili"

Modello: Analizziamo i dati.

         ▶ Codice eseguito ──────────── [⌄]

   ┌─────────────────────────────────────┐
   │ 📊 Vendite Mensili 2025       [👁]  │  ← Click apre nel pannello
   │ Chart • matplotlib • v1             │
   └─────────────────────────────────────┘

   Il grafico mostra un picco a dicembre...

         [Pannello laterale si apre mostrando il grafico
          in alta risoluzione con pulsante download]
```

---

## Versionamento

Quando l'utente chiede modifiche a un artifact esistente:

1. Il modello genera una nuova versione del codice
2. L'artifact viene aggiornato (nuovo `content`, `version` incrementata)
3. Il pannello mostra la versione aggiornata
4. Le versioni precedenti restano accessibili

```typescript
function updateArtifact(existingId: string, newContent: string): Artifact {
  const existing = getArtifact(existingId);
  return {
    ...existing,
    id: generateId(),
    content: newContent,
    version: existing.version + 1,
    parentId: existing.id,
    messageId: currentMessageId,
  };
}
```

Per collegare un aggiornamento all'artifact giusto, il rilevamento cerca
nella conversazione l'ultimo artifact dello stesso tipo e con titolo simile.

---

## Dipendenze

```bash
npm install mermaid           # Diagrammi
npm install plotly.js-dist-min # Grafici interattivi (se necessario)
# react-markdown già presente in Jan
# Monaco editor già presente o non necessario (tab Code è readonly)
```

---

## Settings

Nelle impostazioni dell'app, sezione Artifacts:

```
┌─────────────────────────────────────────────┐
│  🔲 Artifacts                               │
│                                             │
│  Abilitato:           [✓]                   │
│  Apertura automatica: [✓] Apri pannello     │
│                       quando un artifact    │
│                       viene rilevato        │
│  Posizione:           [Destra ▾]            │
│                       • Destra              │
│                       • Sotto               │
│  Larghezza default:   [45%]                 │
└─────────────────────────────────────────────┘
```

---

## Test

- [ ] Modello genera HTML con `<script>` → pannello si apre con preview interattiva
- [ ] Click pulsanti nell'iframe → funzionano (JS attivo)
- [ ] Modello genera SVG → renderizzato nel pannello
- [ ] Modello genera Mermaid → diagramma renderizzato
- [ ] Code Interpreter produce grafico → mostrato inline + pannello
- [ ] "Cambia il colore in blu" → artifact aggiornato a v2 nel pannello
- [ ] Selettore versione → switch tra v1/v2
- [ ] Tab Code → mostra sorgente con syntax highlighting
- [ ] Tab Preview → mostra rendering live
- [ ] [📋 Copia] → copia codice sorgente
- [ ] [⬇ Scarica] → download file (.html/.svg/.png)
- [ ] [✕] chiude pannello → chat torna full-width
- [ ] Escape chiude pannello
- [ ] Resize bordo → cambia proporzioni chat/pannello
- [ ] [👁] nell'indicatore chat → apre/focalizza artifact nel pannello
- [ ] Snippet Python breve → NON diventa artifact (resta blocco codice)
- [ ] Tema dark → pannello e iframe rispettano il tema
- [ ] Riapertura conversazione → artifact ri-costruiti dai messaggi salvati
