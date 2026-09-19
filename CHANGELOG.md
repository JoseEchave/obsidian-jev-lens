# Changelog

## 0.2.0

- Traffic-light emoji (🟢/🟡/🔴) in the note tab title instead of CSS coloring.
- Tooltips via Obsidian's native `aria-label` mechanism (title attributes are
  suppressed in Electron). Hover the tab or status indicator for the per-lens
  breakdown; clicking the status indicator shows it as a Notice.
- Tab header lookup fixed for current Obsidian (`leaf.tabHeaderEl`).
- Lenses are parsed live from the lenses note on every evaluation.

## 0.1.0

- Initial version: per-lens Score questions over the active note, CSS tab
  coloring, status-bar readout, content-hash caching.
