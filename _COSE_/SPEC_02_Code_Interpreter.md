# TASK: Code Interpreter — Comportamento stile Claude Desktop

## Come funziona su Claude Desktop (il modello da replicare)

Su Claude Desktop, il Code Interpreter non è un "pulsante per eseguire codice".
È un **ciclo automatico** dove il modello:

1. Decide autonomamente di scrivere ed eseguire codice
2. Il codice viene eseguito automaticamente (l'utente non clicca nulla)
3. Il modello **vede l'output** (stdout, errori, grafici)
4. Se c'è un errore, il modello **corregge e ri-esegue** senza intervento
5. Se servono più step, il modello **concatena esecuzioni multiple**
6. L'output finale (grafici, tabelle, file) viene mostrato inline nella chat

L'utente non interagisce col codice — interagisce solo con la conversazione.
Il codice è un "mezzo" che il modello usa per risolvere il problema.

### Esempio concreto di flusso

```
Utente: "Analizza questo CSV e trova le correlazioni tra le colonne"
         [allega file.csv]

Modello: Vediamo i dati che hai caricato.

         ▶ Codice eseguito ──────────────────── [⌄]
         ┌───────────────────────────────────────┐
         │ Output:                               │
         │   col_a  col_b  col_c                 │
         │ 0  1.2    3.4    5.6                  │
         │ ...                                   │
         └───────────────────────────────────────┘

         Ok, ci sono 3 colonne numeriche. Calcoliamo le correlazioni.

         ▶ Codice eseguito ──────────────────── [⌄]
         ┌───────────────────────────────────────┐
         │ [Heatmap delle correlazioni - PNG]     │
         └───────────────────────────────────────┘

         Dall'analisi emerge che col_a e col_c hanno una forte
         correlazione positiva (0.92), mentre col_b è inversamente
         correlata con entrambe.
```

### Aspetti chiave

1. **Esecuzione AUTOMATICA** — il blocco codice appare, si esegue, l'output appare.
   Nessun pulsante. (Toggle nelle settings per chi vuole conferma manuale.)

2. **Il modello VEDE l'output** — l'output viene iniettato nel contesto come
   messaggio tool/system, così il modello può reagire, commentare, correggere.

3. **Stato Python persistente** — le variabili del blocco 1 esistono nel blocco 2.
   Il modello può fare analisi incrementale su più step.

4. **Codice collassato di default** — il focus è sull'output, non sul codice.
   L'utente espande il codice solo se vuole vederlo.

5. **File upload** — file allegati alla chat disponibili come `/tmp/<filename>`
   nel filesystem virtuale Pyodide.

6. **Auto-correzione** — se il codice genera un errore, il modello lo vede e
   genera una versione corretta che viene automaticamente ri-eseguita.

---

## Architettura — il ciclo di esecuzione

```
Utente invia messaggio (+ eventuali file allegati)
        │
        ▼
Messaggio inviato al modello con system prompt Code Interpreter
        │
        ▼
Il modello risponde in streaming
        │
        ├── Testo normale → renderizzato nella chat
        │
        ├── Blocco ```python rilevato → ESECUZIONE AUTOMATICA
        │       │
        │       ▼
        │   1. Web Worker Pyodide esegue il codice
        │   2. Output catturato (stdout, immagini, errori)
        │   3. Output renderizzato inline (collassato)
        │   4. Output aggiunto al contesto conversazione
        │
        ├── Altro testo → renderizzato
        │
        └── Fine risposta del modello
                │
                ▼
        Se l'ultimo blocco ha prodotto output/errore:
        → Nuova chiamata automatica al modello con output nel contesto
        → Il modello può commentare, generare altro codice, o concludere
        → Ripeti fino a quando il modello risponde solo con testo
```

### Iniezione dell'output nel contesto

Dopo ogni esecuzione, l'output viene aggiunto alla conversazione:

```json
[
  {"role": "user", "content": "Analizza il CSV"},
  {"role": "assistant", "content": "Vediamo i dati.\n```python\nimport pandas as pd\ndf = pd.read_csv('/tmp/data.csv')\nprint(df.head())\n```"},
  {"role": "tool", "content": "[Code Interpreter Output]\n  col_a  col_b\n0  1.2    3.4\n1  2.3    4.5"},
  {"role": "assistant", "content": "Ok, ci sono 2 colonne. Calcoliamo...\n```python\nplt.plot(...)```"},
  {"role": "tool", "content": "[Code Interpreter Output]\n[image: base64...]"},
  {"role": "assistant", "content": "Il grafico mostra una chiara tendenza..."}
]
```

**Nota**: se il modello Ollama non supporta il role `tool`, usare `system` o `user`
con un prefisso chiaro tipo `[Code Output]:`.

### Limite di iterazioni

Per evitare loop infiniti di esecuzione-correzione:
- Massimo **5 esecuzioni consecutive** per turno
- Dopo 5 fallimenti, mostrare l'errore all'utente e fermarsi
- Configurabile nelle settings

---

## Web Worker Pyodide

### Struttura

```typescript
// pyodide.worker.ts

let pyodide: any = null;

async function ensurePyodide() {
  if (!pyodide) {
    // Segnala caricamento al frontend
    self.postMessage({ type: 'loading', progress: 0 });
    
    importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.js');
    pyodide = await (self as any).loadPyodide();
    await pyodide.loadPackage(['numpy', 'pandas', 'matplotlib', 'micropip']);
    
    self.postMessage({ type: 'ready' });
  }
  return pyodide;
}

async function runCode(code: string): Promise<ExecutionResult> {
  const py = await ensurePyodide();
  await py.loadPackagesFromImports(code);

  // Wrapper che cattura stdout, stderr, immagini matplotlib
  const wrapper = `
import sys, io, base64, json

_stdout = io.StringIO()
_stderr = io.StringIO()
_images = []
sys.stdout = _stdout
sys.stderr = _stderr

try:
    import matplotlib
    matplotlib.use('AGG')
    import matplotlib.pyplot as plt
    def _capture_plots():
        for n in plt.get_fignums():
            fig = plt.figure(n)
            buf = io.BytesIO()
            fig.savefig(buf, format='png', dpi=150, bbox_inches='tight', facecolor='white')
            buf.seek(0)
            _images.append(base64.b64encode(buf.read()).decode())
            plt.close(fig)
    _orig_show = plt.show
    plt.show = lambda *a, **kw: _capture_plots()
except ImportError:
    pass

_exec_error = None
try:
    exec("""${code.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')}""", globals())
except Exception:
    import traceback
    _exec_error = traceback.format_exc()

try:
    import matplotlib.pyplot as plt
    if plt.get_fignums(): _capture_plots()
except: pass

sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__

json.dumps({
    'stdout': _stdout.getvalue(),
    'stderr': _stderr.getvalue(),
    'images': _images,
    'error': _exec_error
})
`;
  const resultJson = py.runPython(wrapper);
  return JSON.parse(resultJson);
}

// Scrivere file nel filesystem virtuale (per upload utente)
function writeFile(name: string, data: Uint8Array) {
  pyodide.FS.writeFile(`/tmp/${name}`, data);
}

// Reset ambiente per nuova conversazione
function resetEnv() {
  if (pyodide) {
    pyodide.runPython(`
for _k in list(globals()):
    if not _k.startswith('_') and _k != '__builtins__':
        del globals()[_k]
`);
  }
}

self.onmessage = async (e) => {
  const { type, id } = e.data;
  
  if (type === 'run') {
    const start = Date.now();
    try {
      const result = await runCode(e.data.code);
      self.postMessage({ type: 'result', id, data: { ...result, duration: Date.now() - start } });
    } catch (err) {
      self.postMessage({ type: 'error', id, data: { error: String(err) } });
    }
  }
  if (type === 'upload') writeFile(e.data.name, e.data.data);
  if (type === 'reset') { resetEnv(); self.postMessage({ type: 'reset_done' }); }
};
```

---

## UI nella chat — rendering stile Claude

### Blocco codice eseguito (default: collassato)

```
▶ Codice eseguito ─────────────────────── [⌄ Mostra codice]
┌─────────────────────────────────────────────────────────┐
│   col_a  col_b  col_c                                   │
│ 0  1.2    3.4    5.6                                    │
│ 1  2.3    4.5    6.7                                    │
└─────────────────────────────────────────────────────────┘
```

### Click su "Mostra codice" → espanso

```
▼ Codice eseguito ─────────────────────── [⌃ Nascondi codice]
┌─────────────────────────────────────────────────────────┐
│ import pandas as pd                                      │
│ df = pd.read_csv('/tmp/data.csv')                       │
│ print(df.head())                                         │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ Output:                                                  │
│   col_a  col_b  col_c                                   │
│ 0  1.2    3.4    5.6                                    │
└─────────────────────────────────────────────────────────┘
```

### Errore (che il modello poi corregge automaticamente)

```
▶ Codice eseguito ─────────────────────── [⌄]
┌─────────────────────────────────────────────────────────┐
│ ⚠ NameError: name 'seaborn' is not defined              │
└─────────────────────────────────────────────────────────┘

Mi scuso, devo importare seaborn. Correggo:

▶ Codice eseguito ─────────────────────── [⌄]
┌─────────────────────────────────────────────────────────┐
│ [Heatmap correlazioni - immagine]                       │
└─────────────────────────────────────────────────────────┘
```

### Immagine matplotlib

```
▶ Codice eseguito ─────────────────────── [⌄]
┌─────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────┐ │
│ │                                                     │ │
│ │              [Grafico PNG inline]                    │ │
│ │                                                     │ │
│ └─────────────────────────────────────────────────────┘ │
│                                        [⬇ Scarica PNG] │
└─────────────────────────────────────────────────────────┘
```

### Durante l'esecuzione (stato loading)

```
⟳ Esecuzione in corso... ─────────────────────────────────
```

Con spinner animato. Se Pyodide è ancora in caricamento (prima volta):

```
⟳ Preparazione ambiente Python... ─────────── 67%
  ████████████████████░░░░░░░░░░
```

---

## System prompt da iniettare

Quando il Code Interpreter è abilitato, questo viene aggiunto come system prompt
(prima del system prompt custom dell'utente/progetto):

```
You have access to a Python code interpreter running in a secure sandbox.

WHEN TO USE CODE:
- Mathematical calculations or data analysis
- Reading and analyzing uploaded files (available at /tmp/<filename>)
- Creating charts, graphs, or visualizations
- Data transformations or text processing
- Any task that benefits from precise computation

HOW TO USE:
- Write Python code in a ```python code block
- The code executes automatically — do not ask the user to run it
- You will see the output (stdout, images, errors) after execution
- If there's an error, fix it and try again
- Variables persist between code blocks in the same conversation

AVAILABLE LIBRARIES: numpy, pandas, matplotlib, scipy, scikit-learn, sympy,
seaborn, statistics, collections, itertools, re, json, csv, datetime, math

FOR PLOTS: Always call plt.show() to display charts.
FOR DATA: Print summaries and key statistics.
FOR FILES: Read from /tmp/<filename> (uploaded by user).

Do NOT ask the user for permission to run code. Just write and execute it.
After seeing results, explain them clearly in natural language.
```

---

## Settings

```
┌─────────────────────────────────────────────┐
│  🐍 Code Interpreter                        │
│                                             │
│  Abilitato:          [✓]                    │
│                                             │
│  Esecuzione:         [Automatica ▾]         │
│                       • Automatica           │
│                       • Chiedi conferma      │
│                                             │
│  Auto-correzione:    [✓] Il modello corregge│
│                      automaticamente errori  │
│                                             │
│  Max iterazioni:     [5] per turno          │
│  Timeout:            [30] secondi per blocco│
│                                             │
│  Pyodide: ● Pronto (v0.27.5)               │
│  [Precarica ora] [Pulisci cache]            │
└─────────────────────────────────────────────┘
```

---

## Test

- [ ] "Quanto fa 2^100?" → codice auto-eseguito, risultato inline, codice collassato
- [ ] Allega CSV + "analizza" → modello legge file, stampa statistiche, genera grafico
- [ ] Codice con errore → modello vede errore, genera versione corretta, ri-esegue
- [ ] Due blocchi nella stessa risposta → variabili condivise tra i blocchi
- [ ] Grafico matplotlib → immagine PNG inline con pulsante download
- [ ] DataFrame → tabella formattata
- [ ] Loop infinito → timeout dopo 30s
- [ ] Prima esecuzione in assoluto → barra progresso caricamento Pyodide
- [ ] Nuova conversazione → ambiente Python resettato
- [ ] Toggle "Chiedi conferma" → mostra pulsante [▶] invece di auto-eseguire
- [ ] Code Interpreter disabilitato → blocchi codice normali senza esecuzione
- [ ] 5 errori consecutivi → si ferma e mostra errore all'utente
- [ ] Blocco codice JavaScript o altro linguaggio → NON viene eseguito
