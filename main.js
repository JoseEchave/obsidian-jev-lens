/* Jev Lens — evaluates the active note against your yearly-review lenses
 * with TypeSafe Jev (System One) and shows a traffic-light emoji (🟢🟡🔴)
 * in the note tab title. Plain JS, no build step.
 * API: POST https://api.typesafe.ai/v1/systemone */

const {
  Plugin, PluginSettingTab, Setting, MarkdownView, Notice, requestUrl,
} = require('obsidian');

const API_URL = 'https://api.typesafe.ai/v1/systemone';

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'jev-latest',
  intervalSec: 120,
  strongThreshold: 2.0, // max lens score >= this -> 🟢
  dimThreshold: 1.3,    // max lens score >= this -> 🟡, below -> 🔴
  minChars: 200,        // shorter notes are not evaluated
  lensesPath: 'Lenses.md', // vault path of your lenses note (see README)
};

const LENS_ICONS = ['💜', '🛡️', '🧘', '🎨', '🧭'];

/* Fallback if the lenses note can't be parsed. */
const FALLBACK_LENSES = [
  { name: 'WORTHINESS & SUFFICIENCY',
    definition: 'being worthy without earning, trusting you are enough, a kind inner dialogue, rest as birthright, seeing money through trust rather than fear' },
  { name: 'SELF-CARE & BOUNDARIES',
    definition: 'living from genuine wants instead of self-imposed obligations, setting boundaries without guilt, self-care as the foundation, managing and honoring your energy' },
  { name: 'EMBODIMENT & PRESENCE',
    definition: 'feeling emotions in the body not just the head, being fully present instead of mentally elsewhere, vulnerability and honesty with others' },
  { name: 'BEYOND UTILITY',
    definition: 'who you are beyond roles like provider or the strong one, play and curiosity for their own joy, creating with no agenda or productivity goal' },
];

/* ---- lenses parsing ---------------------------------------------------- */

function parseLensesFromNote(md) {
  const sections = [];
  let current = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^###\s+(.*)$/);
    if (h) {
      current = { title: h[1], body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  const lenses = [];
  for (const s of sections) {
    const lm = s.title.match(/Lens\s*#\d+[:\s]\s*(.+)/i);
    if (!lm) continue;
    const name = lm[1].replace(/[^\w\s&'-]/g, '').trim();
    const covers = s.body.join('\n').match(/\*\*Covers:\*\*\s*(.+)/);
    const definition = covers ? covers[1].trim() : name;
    if (name) lenses.push({ name, definition });
  }
  return lenses.length >= 2 ? lenses.slice(0, LENS_ICONS.length) : null;
}

function lensQuestions(lenses) {
  const questions = {};
  lenses.forEach((lens, i) => {
    questions[`lens_${i}`] = {
      type: 'score',
      instructions:
        `Rate how strongly the note engages with this lens — ${lens.name}: ` +
        `${lens.definition}. Judge only this theme, not the note's overall quality.`,
      criteria: [
        `The note has essentially nothing related to this theme (${lens.name}).`,
        `The theme (${lens.name}) appears only incidentally or in passing.`,
        `The note substantially explores or reflects the theme (${lens.name}).`,
        `This theme (${lens.name}) is central; the note reads as written through this lens.`,
      ],
    };
  });
  return questions;
}

/* ---- helpers ------------------------------------------------------------ */

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

function findTabHeader(leaf) {
  // Obsidian exposes tabHeaderEl (and tabHeaderInnerTitleEl) on WorkspaceLeaf.
  if (leaf.tabHeaderEl) return leaf.tabHeaderEl;
  // Fallback: locate by index among sibling tabs.
  const tabsRoot = leaf.containerEl && leaf.containerEl.closest('.workspace-tabs');
  if (!tabsRoot) return null;
  const leaves = Array.from(
    tabsRoot.querySelectorAll('.workspace-tab-container > .workspace-leaf'));
  const idx = leaves.indexOf(leaf.containerEl);
  if (idx < 0) return null;
  return tabsRoot.querySelectorAll(
    '.workspace-tab-header-container-inner > .workspace-tab-header')[idx] || null;
}

/* ---- plugin ------------------------------------------------------------- */

class JevLensPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.cache = new Map();       // contentHash -> assessment
    this.lastAssessment = null;   // assessment for the currently active note
    this.lastNoteName = '';
    this.inFlight = false;
    this.lastHash = null;
    this.lastNotified = 0;

    this.addSettingTab(new JevLensSettingTab(this.app, this));

    this.addCommand({
      id: 'evaluate-now',
      name: 'Evaluate active note now',
      callback: () => this.evaluateActive(true),
    });

    this.registerEvent(this.app.workspace.on(
      'active-leaf-change', () => this.evaluateActive()));

    this.registerInterval(window.setInterval(
      () => this.evaluateActive(), this.settings.intervalSec * 1000));

    this.app.workspace.onLayoutReady(() => {
      this.statusBarEl = this.addStatusBarItem();
      this.statusBarEl.addClass('jev-status');
      this.statusBarEl.setText('Jev ⏳');
      this.registerDomEvent(this.statusBarEl, 'click', () => {
        if (this.lastAssessment) {
          new Notice(this.tooltipText(this.lastAssessment, this.lastNoteName), 8000);
        }
      });
      this.evaluateActive();
    });
  }

  onunload() {
    document.querySelectorAll('.jev-dot').forEach((el) => el.remove());
    document.querySelectorAll('.jev-lens-tab').forEach((el) => {
      el.classList.remove('jev-lens-tab');
      el.removeAttribute('aria-label');
    });
    document.querySelectorAll('.jev-status').forEach((el) => {
      el.setText('');
      el.removeAttribute('aria-label');
    });
  }

  /* ---- settings / api key ---- */

  apiKey() {
    let envKey = '';
    try { envKey = (typeof process !== 'undefined' && process.env) ? process.env.TYPESAFE_API_KEY : ''; }
    catch (e) { /* renderer without node */ }
    return this.settings.apiKey || envKey || '';
  }

  async getLenses() {
    try {
      const f = this.app.vault.getAbstractFileByPath(this.settings.lensesPath);
      if (f) {
        const md = await this.app.vault.cachedRead(f);
        const parsed = parseLensesFromNote(md);
        if (parsed) return parsed;
      }
    } catch (e) { /* fall through */ }
    return FALLBACK_LENSES;
  }

  /* ---- evaluation ---- */

  async evaluateActive(force = false) {
    if (this.inFlight) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) return;
    const text = view.editor.getValue();
    const noteName = view.file.name;

    if (text.trim().length < this.settings.minChars) {
      this.lastAssessment = null;
      this.lastNoteName = noteName;
      this.apply(view.leaf, null, noteName);
      return;
    }
    const hash = hashStr(text);
    const hit = this.cache.get(hash);
    if (hit) {
      this.lastAssessment = hit;
      this.lastNoteName = noteName;
      this.apply(view.leaf, hit, noteName);
      return;
    }
    if (!force && this.lastHash === hash) return; // interval tick, nothing changed
    if (!this.apiKey()) {
      this.noticeOnce('Jev Lens: no API key set. Open Settings → Jev Lens.');
      return;
    }

    this.inFlight = true;
    this.lastHash = hash;
    try {
      const lenses = await this.getLenses();
      const body = JSON.stringify({
        model: this.settings.model,
        state: { note: text },
        questions: lensQuestions(lenses),
      });
      const res = await requestUrl({
        url: API_URL,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey()}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      const data = res.json;
      const scores = lenses.map((lens, i) => {
        const a = data.answers[`lens_${i}`];
        return { name: lens.name, score: a ? a.score : 0, confidence: a ? a.confidence : 0 };
      });
      const assessment = { scores, ts: Date.now() };
      if (this.cache.size > 50) this.cache.clear();
      this.cache.set(hash, assessment);
      this.lastAssessment = assessment;
      this.lastNoteName = noteName;
      this.apply(view.leaf, assessment, noteName);
    } catch (e) {
      this.noticeOnce('Jev Lens: ' + (e && e.message ? e.message : 'request failed'));
    } finally {
      this.inFlight = false;
    }
  }

  /* ---- rendering ---- */

  trafficEmoji(maxScore) {
    if (maxScore >= this.settings.strongThreshold) return '🟢';
    if (maxScore >= this.settings.dimThreshold) return '🟡';
    return '🔴';
  }

  tooltipText(assessment, noteName) {
    if (!assessment) return `Jev Lens — ${noteName}\n(not evaluated)`;
    return `Jev Lens — ${noteName}\n` + assessment.scores
      .map((s, i) => `${LENS_ICONS[i % LENS_ICONS.length]} ${s.name}: ${s.score.toFixed(1)}/3`)
      .join('\n');
  }

  apply(leaf, assessment, noteName) {
    const header = findTabHeader(leaf);
    if (header) this.setDot(header, assessment);
    if (this.statusBarEl) {
      if (assessment) {
        let best = 0;
        assessment.scores.forEach((s, i) => {
          if (s.score > assessment.scores[best].score) best = i;
        });
        const emoji = this.trafficEmoji(assessment.scores[best].score);
        this.statusBarEl.setText(emoji + ' ' + assessment.scores
          .map((s, i) => `${LENS_ICONS[i % LENS_ICONS.length]}${s.score.toFixed(1)}`)
          .join(' '));
        this.statusBarEl.setAttribute('aria-label',
          this.tooltipText(assessment, this.lastNoteName));
      } else {
        this.statusBarEl.setText('Jev —');
        this.statusBarEl.removeAttribute('aria-label');
      }
    }
  }

  setDot(header, assessment) {
    const titleEl = header.querySelector('.workspace-tab-header-inner-title');
    if (!titleEl) return;
    let dot = header.querySelector('.jev-dot');
    if (!assessment) {
      if (dot) dot.remove();
      header.classList.remove('jev-lens-tab');
      header.removeAttribute('aria-label');
      return;
    }
    let best = 0;
    assessment.scores.forEach((s, i) => {
      if (s.score > assessment.scores[best].score) best = i;
    });
    const emoji = this.trafficEmoji(assessment.scores[best].score);
    if (!dot) {
      if (!titleEl.firstChild) return;
      dot = document.createElement('span');
      dot.className = 'jev-dot';
      titleEl.insertBefore(dot, titleEl.firstChild);
    }
    dot.textContent = emoji + ' ';
    header.classList.add('jev-lens-tab');
    /* Obsidian renders its native tooltip for elements carrying aria-label
       (same mechanism as its own tab tooltips; title attrs show nothing). */
    header.setAttribute('aria-label',
      this.tooltipText(assessment, this.lastNoteName));
  }

  noticeOnce(msg) {
    const now = Date.now();
    if (now - this.lastNotified < 60000) return;
    this.lastNotified = now;
    new Notice(msg);
  }
}

/* ---- settings tab -------------------------------------------------------- */

class JevLensSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Jev Lens settings' });

    new Setting(containerEl)
      .setName('TypeSafe API key')
      .setDesc('From console.typesafe.ai. Left empty, the plugin tries the TYPESAFE_API_KEY environment variable. The key stays on this machine; note contents are sent to the TypeSafe API for evaluation.')
      .addText((t) => {
        t.inputEl.type = 'password';
        t.setValue(this.plugin.settings.apiKey)
          .onChange(async (v) => {
            this.plugin.settings.apiKey = v.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Model')
      .setDesc('TypeSafe System One model to use.')
      .addText((t) => t.setValue(this.plugin.settings.model)
        .onChange(async (v) => {
          this.plugin.settings.model = v.trim() || 'jev-latest';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Refresh interval (seconds)')
      .setDesc('How often to re-evaluate the active note while you write.')
      .addText((t) => t.setValue(String(this.plugin.settings.intervalSec))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          if (n >= 30) {
            this.plugin.settings.intervalSec = n;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Lens note path')
      .setDesc('Vault path of the note whose "### 🔍 Lens #N" sections (with **Covers:** lines) define the lenses.')
      .addText((t) => t.setValue(this.plugin.settings.lensesPath)
        .onChange(async (v) => {
          this.plugin.settings.lensesPath = v.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Green threshold')
      .setDesc('Highest lens score (0–3) at or above which the tab shows 🟢.')
      .addText((t) => t.setValue(String(this.plugin.settings.strongThreshold))
        .onChange(async (v) => {
          const n = parseFloat(v);
          if (!isNaN(n)) {
            this.plugin.settings.strongThreshold = n;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Yellow threshold')
      .setDesc('Highest lens score at or above which the tab shows 🟡; below it shows 🔴.')
      .addText((t) => t.setValue(String(this.plugin.settings.dimThreshold))
        .onChange(async (v) => {
          const n = parseFloat(v);
          if (!isNaN(n)) {
            this.plugin.settings.dimThreshold = n;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Minimum note length (characters)')
      .setDesc('Shorter notes are not evaluated.')
      .addText((t) => t.setValue(String(this.plugin.settings.minChars))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          if (n >= 0) {
            this.plugin.settings.minChars = n;
            await this.plugin.saveSettings();
          }
        }));
  }
}

module.exports = JevLensPlugin;
