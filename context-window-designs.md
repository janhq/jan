# `/context` view - eleven visual directions

## Brief

The target is a terminal-native view that feels sharper than a generic usage chart without losing the facts users need. The Slack direction is intentionally split:

- Edgy and recognizably Jan.
- Informative before decorative.
- Try the 8-bit banana bucket rather than rejecting it on principle.
- Stay practical in a TUI: fixed-width cells, no emoji-width surprises, useful in monochrome, and graceful at narrow widths.

All mockups use the same sample so they can be compared directly:

- Model: `tokamak-1-preview`
- Window: 234K tokens
- Current fill: 120K, provider-reported, 51.5%
- Estimated categories: prompt 6K, tools 9K, project context 2.1K, skills 8K, messages 95K
- Free space: 79K
- Autocompact buffer: 35K, beginning at 85% fill

The `K` values above are abbreviated display strings, not exact inputs for recomputing the shown percentages. Every mock uses one reproducible raw fixture: `window=234000`, provider `fill=120490`, estimated `prompt=6049`, `tools=9000`, `project=2149`, `skills=8049`, `messages=95253`, derived `free=78500`, and configured `buffer=35000`. Those seven category values sum to 234000 and render exactly as the abbreviated counts and percentages shown. The provider fill and independently estimated category total differ by 10 tokens, which is expected. A 234K Tokamak window implies a configured override; the current catalog default is 200K.

## What the current `/context` uses

The implementation in PR #8799 is a **200-cell row-major heatmap plus an adaptive side ledger**:

- 20 columns by 10 rows, exactly 200 cells.
- In a normal, non-overshooting report, one cell is 0.5% of the window. If estimates exceed the window, cells normalize over the segment total so the grid remains exactly 200 cells.
- Largest-remainder allocation keeps the total at 200; every non-zero category gets at least one cell.
- Grid order is system prompt, system tools, project context, skills, messages, free space, then autocompact buffer.
- The first four categories deliberately share one system glyph. The legend separates them, but the map does not.
- Runtime styling is yellow system `⛁`, cyan messages `⛃`, dark-gray free space `⛶`, and magenta buffer `⛝`.
- Wide terminals place the ledger beside the heatmap. Medium terminals put it below. Below 41 columns, the heatmap disappears and only the clipped ledger remains.
- The fill headline is provider-reported when fresh and visibly estimated otherwise. The category ledger is always estimated.

Representative current layout:

```text
Context Usage
⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁  tokamak/tokamak-1-preview (234k context)
⛁ ⛁ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃  tokamak-1-preview[234k] · configured window
⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃  120K/234k tokens (51.5%)
⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃
⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃ ⛃  Estimated usage by category
⛃ ⛃ ⛃ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶  ⛁ System prompt: 6K tokens (2.6%)
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶  ⛁ System tools: 9K tokens (3.8%)
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶  ⛁ System context: 2.1K tokens (0.9%)
⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝  ⛁ Skills: 8K tokens (3.4%)
⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝  ⛃ Messages: 95K tokens (40.7%)
                                          ⛶ Free space: 79K (33.5%)
                                          ⛝ Autocompact buffer: 35K tokens (15.0%)
```

This is mathematically exact and already responsive. Its main visual weaknesses are the large vertical footprint, the abstract chess-like glyphs, and the fact that four system categories collapse into one visual block.

## Presentation families

1. **Matrix and heatmap** - the current view, Signal Deck, Banana Bucket, and Context Cartridge. Exact area allocation, largest footprint.
2. **Linear meter** - Context Tape and Threshold Rail. Best for current fill and the compaction boundary.
3. **Small-multiple bars** - Bank Bars. Best category comparison and accessibility.
4. **Hierarchy and flow** - Capacity Tree. Best explanation of how capacity, free space, and buffer relate.
5. **Spatial compartments** - Reactor Core and Cargo Bay. Strong visual identity, but area becomes approximate.
6. **Hybrid operational and diagnostic** - Rail + Banks. Threshold status first, complete category comparison second.

**Shortlist by goal:**

- Lowest-risk refinement -> Concept 1, Signal Deck.
- Most Jan personality -> Concept 2, Banana Bucket.
- Best edge plus detail -> Concept 3, Context Cartridge.
- Most informative -> Concept 8, Capacity Tree.
- Most compact -> Concept 10, Threshold Rail.
- Best balanced default -> Concept 11, Rail + Banks.


---

## Concept 1 - Signal Deck

A disciplined refinement of the current design. The normal 20-by-10 map stays literal: one character is one nominal 0.5% cell. Overfull estimates normalize across the 200 cells. Letters make every category readable without color. Runtime color adds hierarchy but is not required.

```text
CONTEXT // TOKAMAK-1-PREVIEW                                      REPORTED
120K / 234k  [51.5%]                              AUTO-COMPACT @ 199K

PPPPPTTTTTTTTCCKKKKK   P  SYSTEM PROMPT       6K   2.6%
KKMMMMMMMMMMMMMMMMMM   T  SYSTEM TOOLS        9K   3.8%
MMMMMMMMMMMMMMMMMMMM   C  PROJECT CONTEXT    2.1K  0.9%
MMMMMMMMMMMMMMMMMMMM   K  SKILLS               8K   3.4%
MMMMMMMMMMMMMMMMMMMM   M  MESSAGES            95K  40.7%
MMM.................   .  FREE SPACE          79K  33.5%
....................   B  COMPACT BUFFER      35K  15.0%
....................
..........BBBBBBBBBB   FILL: REPORTED
BBBBBBBBBBBBBBBBBBBB   SPLIT: ESTIMATED
```

**Tone:** Precise, technical, calm.

**Strengths:** Exact 200-cell contract, strongest monochrome readability, minimal code change, easy narrow fallback.

**Risk:** It is an improved chart rather than a new visual identity. "Edgy" comes mostly from typography and color.

**Narrow behavior:** Move the legend below the map at medium width. Below 42 columns, show the headline and ledger without the map.

---

## Concept 2 - Banana Bucket

The deliberately playful option. The bucket is still a 20-by-10 allocation map. Occupied cells are banana slices, free cells are dots, and the protected buffer is a hard floor. In the real TUI, occupied slices change color by category; the Markdown mock cannot show those color transitions.

```text
                 .- BANANA BUCKET / CTX 51.5% -.
                /-------------------------------\
               |  ))))))))))))))))))))           |
               |  ))))))))))))))))))))           |
               |  ))))))))))))))))))))           |
               |  ))))))))))))))))))))           |
               |  ))))))))))))))))))))           |
               |  ))).................           |
               |  ....................           |
               |  ....................           |
               |  ..........##########           |
                \ ####################          /
                 '-----------------------------'
                    120K / 234k  REPORTED

  ) ripe context  120K  51.5%       . free space       79K  33.5%
  # protected peel 35K  15.0%       auto-compact starts at 199K

  ESTIMATED SPLIT
  prompt 6K | tools 9K | project 2.1K | skills 8K | messages 95K
```

**Tone:** Playful, irreverent, unmistakable.

**Strengths:** Most memorable, directly answers the Slack idea, still exposes all real numbers, exact 200-cell capacity.

**Risk:** The joke can dominate a serious diagnostic surface. Category colors are less accessible in monochrome, so the ledger must always remain visible. "Protected peel" is fun but should probably become "autocompact buffer" in production.

**Narrow behavior:** Drop the bucket outline first, leaving the 20-character fill rows and ledger. At very small widths, render only the measured fill and category list.

---

## Concept 3 - Context Cartridge

Treat the window as a loaded memory cartridge. The 200-cell grid becomes an addressable memory map, with offsets making the allocation feel intentional rather than ornamental.

```text
╔═ JAN CTX CARTRIDGE / SLOT 01 ═══════════════════════════════════╗
║ TOKAMAK-1-PREVIEW     CAP 234K     LOAD 120K     51.5% REPORTED ║
╠═══════════════ MEMORY MAP / 1 CELL ~ 0.5% NOMINAL ════════════════╣
║ 000  PPPPPTTTTTTTTCCKKKKK                                      ║
║ 020  KKMMMMMMMMMMMMMMMMMM                                      ║
║ 040  MMMMMMMMMMMMMMMMMMMM                                      ║
║ 060  MMMMMMMMMMMMMMMMMMMM                                      ║
║ 080  MMMMMMMMMMMMMMMMMMMM                                      ║
║ 100  MMM.................                                      ║
║ 120  ....................                                      ║
║ 140  ....................                                      ║
║ 160  ..........BBBBBBBBBB                                      ║
║ 180  BBBBBBBBBBBBBBBBBBBB                                      ║
╠═ BANK TABLE / ESTIMATED ═══════════════════════════════════════╣
║ P PROMPT       6K   2.6%   T TOOLS        9K   3.8%             ║
║ C PROJECT     2.1K  0.9%   K SKILLS       8K   3.4%             ║
║ M MESSAGES     95K 40.7%   . FREE         79K  33.5%            ║
║ B BUFFER       35K 15.0%   COMPACT IRQ @ 199K                   ║
╚═════════════════════════════════════════════════════════════════╝
```

**Tone:** 8-bit hardware, technical, slightly dangerous.

**Strengths:** Exact 200-cell contract, strongest mix of edge and information, accessible without color, obvious relationship between cells and percentages.

**Risk:** The full border needs about 70 columns. The address labels are visual flavor, not additional data, so they should stay dim.

**Narrow behavior:** Remove the outer frame and bank table columns, then stack each bank on one line. Below 42 columns, omit the memory map and retain the headline plus bank table.

---

## Concept 4 - Reactor Core

Make proximity to autocompaction the central visual. This is the most operational design: current fill is a pressure line, free space is headroom, and the buffer is visibly protected above the 85% trigger.

```text
TOKAMAK CONTEXT CORE                           STATUS: NOMINAL
MODEL tokamak-1-preview                 FILL SOURCE: PROVIDER

100%  ┌────────────────────────┐  234K CAPACITY
      │ BBBBBBBBBBBBBBBBBBBBBB │
 85%  ├────────────────────────┤  AUTO-COMPACT / 199K
      │ ...................... │
      │ ...................... │  79K HEADROOM
51.5% ├────────────────────────┤  NOW / 120K
      │ MMMMMMMMMMMMMMMMMMMMMM │
      │ MMMMMMMMMMMMMMMMMMMMMM │  MESSAGES 95K
      │ MMMMMMMMMMMMMMMMMMMMMM │
      │ KKK C TT P             │  SYSTEM + PROJECT 25K
  0%  └────────────────────────┘

PROMPT 6K 2.6% | TOOLS 9K 3.8% | PROJECT 2.1K 0.9% | SKILLS 8K 3.4%
MESSAGES 95K 40.7% | FREE 79K 33.5% | BUFFER 35K 15.0%
CATEGORY SPLIT ESTIMATED
```

**Tone:** Industrial, high-stakes, Tokamak-native.

**Strengths:** Best explanation of why the buffer exists, fastest view for "am I close to compaction?", strong identity with the current model family.

**Risk:** Vertical proportions become approximate unless the core remains exactly 10 rows. It also privileges pressure over detailed allocation. Selecting this concept requires relaxing or rewriting the issue's exact 20-by-10 row-major presentation requirement.

**Narrow behavior:** The core remains usable down to about 32 columns. The category ledger wraps below it.

---

## Concept 5 - Black Box Receipt

A dense diagnostic readout with almost no decoration. It feels like a flight recorder or debugger command rather than a dashboard. This is the most terminal-native option and the cheapest to scan repeatedly.

```text
JAN/CTX BLACKBOX 01       tokamak-1-preview       CAP=234000
FILL=120490  PCT=51.5  SRC=provider  COMPACT_AT=199000  STATE=nominal

BANK  TYPE              TOKENS    WINDOW   SOURCE
P     system-prompt       6049      2.6%   estimate
T     system-tools        9000      3.8%   estimate
C     project-context     2149      0.9%   estimate
K     skills              8049      3.4%   estimate
M     messages           95253     40.7%   estimate
.     free-space         78500     33.5%   derived
B     compact-buffer     35000     15.0%   configured

MAP   PPPPPTTTTTTTTCCKKKKK|KKMMMMMMMMMMMMMMMMMM|MMMMMMMMMMMMMMMMMMMM
      MMMMMMMMMMMMMMMMMMMM|MMMMMMMMMMMMMMMMMMMM|MMM.................
      ....................|....................|..........BBBBBBBBBB
      BBBBBBBBBBBBBBBBBBBB

HEADROOM=78500  CELLS=200/200  NEXT=auto-compact  RESULT=OK
```

**Tone:** Raw, terse, hacker-facing.

**Strengths:** Highest information density, every value carries provenance, trivial monochrome support, naturally degrades to narrow terminals.

**Risk:** Least friendly for non-technical users and visually closer to logs than product UI. The long map is secondary and could be removed entirely.

**Narrow behavior:** The table becomes `key=value` lines. No distinct fallback renderer is required.

---

## Concept 6 - Context Tape

Treat the 200 cells as a continuous instrument tape rather than a square field. Offsets and threshold markers make the exact allocation easier to trace.

```text
CTX TAPE // 200 CELLS // 120K / 234K // 51.5% REPORTED

000-049  PPPPPTTTTTTTTCCKKKKKKKMMMMMMMMMMMMMMMMMMMMMMMMMMMM
050-099  MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM
100-149  MMM...............................................
             ^ NOW / CELL 103
150-199  ....................BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
                             ^ AUTO-COMPACT / CELL 170

P PROMPT | T TOOLS | C PROJECT | K SKILLS | M MESSAGES | . FREE | B BUFFER
SPLIT ESTIMATED
```

**Tone:** Instrumentation, tape drive, industrial telemetry.

**Strengths:** Preserves all 200 cells, shows exact offsets, makes the current and autocompact positions explicit, lower height than the current grid.

**Risk:** Needs about 61 columns. Long runs are harder to compare than per-category bars.

**Narrow behavior:** Rewrap the tape to 20 cells per line or drop the tape and keep offset totals.

---

## Concept 7 - Bank Bars

Give every category the same 0-100% baseline. Fractional block glyphs preserve small segments without giving them a fake full cell.

```text
CONTEXT BANKS // TOKAMAK-1-PREVIEW          FILL 120K / 234K / 51.5%

P  PROMPT    2.6%  [▌░░░░░░░░░░░░░░░░░░░]   6K
T  TOOLS     3.8%  [▊░░░░░░░░░░░░░░░░░░░]   9K
C  PROJECT   0.9%  [▏░░░░░░░░░░░░░░░░░░░]  2.1K
K  SKILLS    3.4%  [▋░░░░░░░░░░░░░░░░░░░]   8K
M  MESSAGES 40.7%  [████████▏░░░░░░░░░░░]  95K
.  FREE     33.5%  [██████▋░░░░░░░░░░░░░]  79K
B  BUFFER   15.0%  [███░░░░░░░░░░░░░░░░░]  35K

FILL REPORTED // BANKS ESTIMATED // AUTO-COMPACT @ 199K
```

**Tone:** Scientific instrument panel.

**Strengths:** Fastest category comparison, clear in monochrome, labels never depend on color, naturally readable by screen readers when flattened.

**Risk:** The bars no longer form one partition of the whole window. Fractional block support must be checked against target terminals.

**Narrow behavior:** Shorten each bar from 20 to the available width while retaining the exact percentage and token label.

---

## Concept 8 - Capacity Tree

Show the accounting hierarchy directly. This answers three different questions in order: total capacity, usable range before autocompaction, and what occupies the current fill.

```text
CTX CAPACITY TREE // TOKAMAK-1-PREVIEW

234K CAPACITY / CATALOG
+-- 35K AUTOCOMPACT BUFFER / CONFIGURED / 15.0%
`-- 199K OPERATING RANGE
    +-- 79K FREE TO COMPACTION / DERIVED / 33.5%
    `-- 120K CURRENT FILL / PROVIDER / 51.5%
        +--  6K SYSTEM PROMPT / ESTIMATE / 2.6%
        +--  9K SYSTEM TOOLS / ESTIMATE / 3.8%
        +-- 2.1K PROJECT CONTEXT / ESTIMATE / 0.9%
        +--  8K SKILLS / ESTIMATE / 3.4%
        `-- 95K MESSAGES / ESTIMATE / 40.7%

NEXT EVENT: AUTO-COMPACT IN 79K
```

**Tone:** System plan, dependency tree, brutally factual.

**Strengths:** Best explanation of the data model, strongest provenance labeling, tiny implementation surface, excellent narrow-terminal behavior.

**Risk:** No proportional area view. Users read numbers rather than seeing window shape. Selecting it replaces the 200-cell visual requirement.

**Narrow behavior:** Already narrow. Indentation can collapse one level below about 32 columns.

---

## Concept 9 - Cargo Bay

A TUI treemap: categories become hard-edged compartments. It creates a physical sense of occupied, free, and protected space without the banana joke.

```text
CTX CARGO BAY // 234K CAPACITY // 120K LOADED // 51.5% REPORTED

+----------------------+------------------------------------------+
|SYSTEM / 25K          |MESSAGES / 95K                            |
|P 6K  T 9K            |M 95K / 40.7%                             |
|C 2.1K  K 8K          |ESTIMATED CATEGORY SPLIT                  |
+------------------------------------------------+----------------+
|FREE / 79K / 33.5%                              |BUFFER / 35K    |
|79K UNTIL AUTO-COMPACT                          |15.0%           |
+------------------------------------------------+----------------+
```

**Tone:** Mechanical storage plan, cargo manifest, Swiss-industrial grid.

**Strengths:** Distinctive without being jokey, grouping is obvious, system subcategories stay together, excellent use of hard terminal geometry.

**Risk:** Character area only approximates token area, and responsive treemap reflow is substantially more complex than a bar or tree.

**Narrow behavior:** Collapse into four stacked compartments: system, messages, free, and buffer. Put the system breakdown beneath its compartment.

---

## Concept 10 - Threshold Rail

Reduce the primary visual to the one operational question: where are we relative to autocompaction? Keep the full category ledger below.

```text
CTX RAIL // TOKAMAK-1-PREVIEW                         STATUS NOMINAL

0%                           51.5%                85%     100%
|==============================^...................|#########|
0K                           120K                199K     234K
                              NOW            AUTO-COMPACT

P 6K 2.6% | T 9K 3.8% | C 2.1K 0.9% | K 8K 3.4% | M 95K 40.7%
FREE 79K 33.5% | BUFFER 35K 15.0% | SPLIT ESTIMATED
```

**Tone:** Tactical telemetry, single-purpose control surface.

**Strengths:** Lowest scanning cost, clear threshold, minimal vertical space, easiest to keep visible on repeated `/context` calls.

**Risk:** The compressed rail is approximate, not 200-cell exact. Category composition lives in text rather than the main visual.

**Narrow behavior:** Shorten the rail to available width and wrap the ledger. At extreme widths, show `120K/234K | 79K to compact`.

---

## Concept 11 - Rail + Banks

Combine the Threshold Rail's operational answer with Bank Bars' category detail. The rail answers "how close are we to autocompaction?" first; the equal-scale bars explain what occupies the window immediately below it. The presentation uses plain user-facing language and does not expose rendering provenance or symbol legends.

```text
Context Usage
tokamak-1-preview · 120K / 234K tokens used (51.5%, provider)

Context window
0%                           51.5%                85%     100%
|==============================^...................|╳╳╳╳╳╳╳╳╳|
0K                           120K                199K     234K

79K tokens available before auto-compact

Context breakdown (estimated)
System prompt         2.6%  [▌░░░░░░░░░░░░░░░░░░░]   6K
System tools          3.8%  [▊░░░░░░░░░░░░░░░░░░░]   9K
Project context       0.9%  [▏░░░░░░░░░░░░░░░░░░░]  2.1K
Skills                3.4%  [▋░░░░░░░░░░░░░░░░░░░]   8K
Messages             40.7%  [████████▏░░░░░░░░░░░]  95K
Available            33.5%  [██████▋░░░░░░░░░░░░░]  79K
Auto-compact reserve 15.0%  [███░░░░░░░░░░░░░░░░░]  35K
```

Remove the previous `CTX CONTROL DECK`, `STATUS NOMINAL`, `NOW`, `AUTO-COMPACT`, symbol legend, `BREAKDOWN // ... BASELINE`, one-letter category keys, uppercase abbreviations, and provenance footer. The headline states provider or estimated provenance once. `Context breakdown (estimated)` states category provenance once.
The `╳` hatch marks the reserved autocompact buffer as unavailable to normal conversation content. It replaces `#`, which looked like consumed context.

**Tone:** Direct capacity summary. The rail and bars carry the visual identity; the copy remains ordinary language.

**Strengths:** Fast threshold scan, complete category comparison, visible provenance, and no decoding step before the values make sense.

**Risk:** Free space and buffer still appear in both the rail and category rows, but that repetition connects the threshold overview to the detailed accounting.

**Narrow behavior:** Keep the rail and shorten every bar to available width. Below about 32 columns, replace the bars with exact `label tokens percent` rows while retaining the current usage and tokens available before auto-compact.

---

## Comparison

| Concept | Edge | Clarity | Jan voice | 200-cell spec | Narrow TUI | Implementation risk |
|---|---:|---:|---:|---:|---:|---:|
| Signal Deck | 3/5 | 5/5 | 3/5 | Preserved | Strong | Low |
| Banana Bucket | 5/5 | 3/5 | 5/5 | Preserved | Medium | Medium |
| Context Cartridge | 5/5 | 5/5 | 4/5 | Preserved | Strong | Medium |
| Reactor Core | 5/5 | 4/5 | 4/5 | Needs change | Strong | Medium |
| Black Box Receipt | 4/5 | 5/5 | 3/5 | Preserved | Best | Low |
| Context Tape | 4/5 | 4/5 | 3/5 | Preserved | Medium | Low |
| Bank Bars | 2/5 | 5/5 | 2/5 | Reframed | Best | Low |
| Capacity Tree | 3/5 | 5/5 | 3/5 | Removed | Best | Low |
| Cargo Bay | 5/5 | 4/5 | 4/5 | Approximate | Medium | High |
| Threshold Rail | 4/5 | 4/5 | 4/5 | Approximate | Best | Low |
| Rail + Banks | 4/5 | 5/5 | 4/5 | Replaced | Strong | Medium |

## Shared implementation constraints

Whichever direction is selected:

- The headline must prefer the latest provider-reported `prompt_tokens` and visibly say `estimated` when it cannot.
- Category splits remain estimates and must say so even when the headline is provider-reported.
- Free space and the autocompact buffer remain part of the full-window 100% calculation.
- Any non-zero category remains visible in the map or ledger.
- Glyph width must use the existing terminal-width helpers, never UTF-8 byte length.
- Color may reinforce meaning but must not be the only encoding.
- `/usage`, pricing, cost, and persistence remain out of scope.
