# Jev Lens for Obsidian

A small Obsidian plugin that continuously evaluates the note you are writing
against **your personal lenses** using [TypeSafe](https://typesafe.ai)'s
System One model **Jev**, and shows a traffic-light emoji in the note tab:

- 🟢 — the note substantially engages one of your lenses
- 🟡 — a lens appears, but only partially
- 🔴 — the note is off-lens right now

The status bar shows the per-lens scores (one icon per lens, in the order the
lenses are defined). Hover the tab or the status indicator for the breakdown;
click the status indicator for the full report.

<!-- TODO: replace with a screenshot of your own vault
![screenshot](docs/screenshot.png) -->

## The lens idea

Lenses are **not goals, tasks, or categories**. They are a small set of themes
you want to *see the world through* — the questions and distinctions you want
to notice more often while you work, write, and reflect.

A lens is useful precisely when it changes how an ordinary note looks. A daily
log read through a *presence* lens is a different document than the same text
read through a *focus* lens. The plugin's job is to hold those themes up
quietly in the background and signal — with a single colored dot — when what
you are writing right now actually looks through one of them.

Define your lenses in a normal note in your vault (see
[`examples/lenses-template.md`](examples/lenses-template.md) for a placeholder
template). Each lens has a name and a **Covers** line — a concrete definition
of what the theme includes. That definition is what the model judges against,
so concrete beats abstract:

```markdown
### 🔍 Lens #1: <THEME NAME>

**Covers:** <one or two sentences: what counts as this theme, what does not>
```

3–5 lenses work best. The plugin re-reads the lenses note on every evaluation,
so refining a definition applies immediately. The bundled defaults are generic
example lenses (worthiness, boundaries, embodiment, beyond-utility) meant to
be replaced with your own.

## How it works

1. You write in any note, as usual.
2. On note switch and every N seconds (default 120), the plugin:
   - reads your lenses note and extracts the `### 🔍 Lens #N` sections;
   - sends **only the active note's text** to the TypeSafe System One API as
     `state`, with **one Score question per lens** (a 4-level rubric from
     "nothing related to this theme" to "written through this lens");
   - colors the active tab's title with 🟢/🟡/🔴 based on the highest lens
     score, and updates the status-bar readout.
3. Content is content-addressed (hashed): an unchanged note is never sent
   twice. Notes under the minimum length are never sent at all.

No generative AI is involved — Jev is a decision model that returns
calibrated probabilities over *your* rubric, not generated text.

## Install

Manual install (no build step, plain JS):

1. Copy `manifest.json`, `main.js`, and `styles.css` into
   `<vault>/.obsidian/plugins/jev-lens/`.
2. In Obsidian: Settings → Community plugins → enable **Jev Lens**.
3. Settings → Jev Lens → paste your [TypeSafe API key](https://console.typesafe.ai/).
4. Point **Lens note path** at your lenses note (start from
   [`examples/lenses-template.md`](examples/lenses-template.md)).

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| TypeSafe API key | – | From console.typesafe.ai. Falls back to the `TYPESAFE_API_KEY` env var. |
| Model | `jev-latest` | Any System One model your account can use. |
| Refresh interval | 120 s | Re-evaluation cadence while you write (min 30 s). |
| Lens note path | `Lenses.md` | Vault path of the note defining your lenses. |
| Green / yellow threshold | 2.0 / 1.3 | Highest lens score (0–3) that maps to 🟢 / 🟡 / 🔴. |
| Minimum note length | 200 chars | Shorter notes are not evaluated. |

## Privacy

The **contents of the active note** (and the **Covers** lines of your lenses)
are sent to the TypeSafe API for every evaluation. Your API key stays on your
machine. If that trade-off is not acceptable for a note, don't keep it open
while the plugin runs — or unload the plugin and re-enable it later. Nothing
is stored anywhere besides Obsidian's own plugin settings.

## Development

No build step; `main.js` is hand-written plain JS.

```sh
# fast checks, no GUI: syntax + lens parsing/questions harness
node --check main.js
node scripts/test.js

# full smoke test against a running Obsidian (requires the official
# Obsidian CLI: Settings → General → Command line interface)
./scripts/dev-loop.sh /path/to/vault           # full: reload, evaluate, assert
./scripts/dev-loop.sh /path/to/vault reload    # reload the plugin only
```

`dev-loop.sh` reloads the plugin inside the running app, opens a note, forces
an evaluation, asserts the tab indicator/status bar/tooltips, and saves a
screenshot — useful with coding agents, since every assertion is verifiable
from the terminal.

## License

[MIT](LICENSE)
