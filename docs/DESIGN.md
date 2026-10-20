# Jan Docs design rules

The docs use the jan.ai design system, adapted for reading. Tokens live in
`src/app/global.css` (`@theme`); reuse them instead of new values. If
something needs a value that isn't here, add it to the system first.

## Type

No 600 weight, except the solid buttons below.

| Token         | Size / line | Weight  | Used for                                          |
| ------------- | ----------- | ------- | ------------------------------------------------- |
| `doc-display` | 36–56 fluid | 500     | Docs home and 404 title (jan.ai's display-lg size) |
| `doc-title`   | 28 / 36     | 500     | Page title (h1)                                   |
| `doc-h2`      | 20 / 28     | 500     | h2                                                |
| `doc-h3`      | 16 / 24     | 500     | h3, prev/next titles                              |
| `doc-body`    | 15 / 24     | 400     | Body text (ink at 80%), card titles (500)         |
| `doc-small`   | 14 / 20     | 400     | Sidebar, TOC, tables, code, card descriptions     |
| `doc-label`   | 12 / 16     | 500     | Geist Mono caps: section labels, eyebrow, callout label |
| `mono-button` | 14 / 16     | 600     | Solid buttons only (Download, Open in Jan)        |

Bold text is set by weight only, in the surrounding colour.

## Colour

Use the roles, never hex: `page`, `surface`, `raised`, `line`,
`line-strong`, `ink`, `link`, `chip`. Dark mode redefines the same roles
under `.dark`.

Dark mode follows the usual conventions:

| Role          | Light       | Dark           | Used for                                  |
| ------------- | ----------- | -------------- | ----------------------------------------- |
| `page`        | white       | neutral-950    | Background                                |
| `surface`     | neutral-50  | neutral-900    | Cards, code, inputs                       |
| `raised`      | neutral-50  | neutral-800    | Hover, active tabs, dialogs, popovers     |
| `line`        | neutral-200 | white at 8%    | Borders and rules (hold on any layer)     |
| `line-strong` | neutral-300 | white at 20%   | Table heads, quotes                       |
| `ink`         | neutral-950 | neutral-100    | Text, at 100 / 80 / 60 / 40%              |

- Layers get lighter as they come forward; no shadows in dark mode.
- Cards are outlined on the page in light mode and filled with `surface` in
  dark mode (`dark:bg-surface`). On hover they rise to `raised` and the
  edge firms up to `line-strong`. Icon chips sit in a well darker than the
  card (`page`).
- Content images are dimmed to 90% in dark mode. No outline: padded
  screenshots would show an empty frame.
- Body text (80%) stays at 7.6:1 or more on every dark layer.

- Links are `link` (Jan blue) in the body font, no underline. Links that
  leave the docs get a ↗.
- Jan yellow is a fill, never text or icon colour (too little contrast on
  white).
- Icons are `ink`. No brand colours, including on company logos.

## Corner radius

Four steps, nothing else (Fumadocs' own `rounded-md` / `rounded-xs` are
mapped onto them):

| Step    | Class          | Size | Used for                                            |
| ------- | -------------- | ---- | --------------------------------------------------- |
| Round   | `rounded-full` | –    | Icon chips, step numbers                            |
| Box     | `rounded-xl`   | 12px | Cards, callouts, code blocks, images, dialogs, FAQ  |
| Control | `rounded-lg`   | 8px  | Buttons, tabs, inputs, icon buttons, list rows      |
| Inline  | `rounded-sm`   | 4px  | Inline code, kbd, focus rings on text               |

Don't use `rounded-2xl`, `rounded-3xl` or pixel values.

## Icons

- Company logos are solid (`src/components/brand-icons.tsx`, or a solid
  logo from react-icons).
- Everything else is a Lucide line icon, thinned to a 1.75 stroke.

## Components

- **Cards** (`<DocCard>` in `<DocCards>`): icon on a round neutral chip,
  title, a one-phrase description (about 8 words, no em dashes), then a
  bare → in the bottom-right corner. One arrow for every card, inside or
  outside the docs; no "Read" / "Visit" wording. 3 columns on desktop, 2 on
  tablets; on phones each card becomes a compact row with the arrow on the
  right. Hover: a step lighter fill and a slightly darker border.
- **Code blocks**: `surface` fill, 1px `line`, 12px corners, one ink colour,
  copy button on the right. Long lines scroll sideways; they don't wrap.
- **Buttons** (`<Button>`, `<DownloadButton>`): ink fill, Geist Mono caps
  label, 35px tall.
- **Search field**: white with a 1px `line`, 8px corners; in dark mode it
  takes the `surface` fill so it still reads as a field.
- **Copy page**: a bordered button, under the title on narrow screens and at
  the bottom of the right sidebar on wide ones.

## Docs home

Short on purpose: the waving-hand logo beside the title, intro and search;
a tile per doc set; "Start here" with each set's most-read pages in the
tiles' columns; then Jan's social links. No news, blog posts, changelog or
repeated quickstart content.

- Each tile is a picture (white line-art drawing of the product, drawn in
  code in `src/components/home-drawings.tsx`, on a jan.ai brand gradient
  from `public/images/home/`), then the title (with a bare → on its right) and description in
  ink on the page. Text never sits on the gradient.
- Hover: the gradient slowly zooms in and the drawing lifts a little.
- Use jan.ai's own brand gradients, not the ribbed-glass versions and not
  new colours. Keep them calm so the drawing reads: blur each one until
  the tile pictures look equally soft side by side (judge by eye: the
  source gradients differ in detail, so the same settings don't match).

## Layout

- Navbar: 52px from `lg`, 61px below (a 44px menu button with 8px above and
  below). Wordmark and Desktop / Agent tabs on the left (text only: current tab
  in full ink, the other at 60%). In the phone menu they're a segmented
  control instead: a 44px bordered track as wide as the search field, two
  equal halves, the current one filled (`chip`, `raised` in dark); 8px track, 4px
  halves; search, theme and
  Download on the right; icon buttons are bare at 60% ink.
- Side padding: 20px on phones, 24px from `lg`.
- Right sidebar ("On this page") indents by how headings nest, not by
  h2/h3, and marks the current section with a 2px ink line.
- Phone menus roll down from the navbar (rows fade up one after another)
  and roll back up to close. Tap targets are at least 44px.
- No footer.
