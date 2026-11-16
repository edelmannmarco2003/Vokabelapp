/*
 * Vokabel-Parser: macht aus dem Text einer PDF (oder aus eingefügtem Text)
 * eine Tabelle aus Vokabelzeilen.
 *
 * Die Datei enthält nur reine Funktionen ohne Browser-Abhängigkeiten, damit
 * sie mit `npm test` in Node geprüft werden kann. Im Browser hängt sie sich
 * als `VokabelParser` an das globale Objekt.
 *
 * Eingabe für parsePages(): pro Seite eine Liste von Textstücken
 *   { str, x, y, w, h, font }
 * mit x/y in Punkt, y nach unten wachsend (Grundlinie), w = Breite,
 * h = Schrifthöhe.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VokabelParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- Helfer

  function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function quantile(values, q) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // Hängt zwei Teile einer umbrochenen Zelle aneinander.
  function joinCell(a, b) {
    if (!a) return b;
    if (!b) return a;
    // "Kranken-" + "haus": Trennstrich am Zeilenende, ohne Leerzeichen weiter.
    if (/[A-Za-zÀ-ÿ]-$/.test(a) && /^[A-Za-zÀ-ÿ]/.test(b)) return a + b;
    return a + ' ' + b;
  }

  // ------------------------------------------------- Zeilen und Segmente

  // Fasst Textstücke mit (fast) gleicher Grundlinie zu Zeilen zusammen und
  // teilt jede Zeile an großen Lücken in Segmente (= Kandidaten für Zellen).
  function buildLines(items) {
    const list = [];
    for (const it of items || []) {
      if (!it || typeof it.str !== 'string' || it.str === '') continue;
      list.push({
        str: it.str,
        x: Number(it.x) || 0,
        y: Number(it.y) || 0,
        w: Math.max(0, Number(it.w) || 0),
        h: Number(it.h) > 0 ? Number(it.h) : 10,
        font: it.font || '',
      });
    }
    list.sort((a, b) => a.y - b.y || a.x - b.x);

    const lines = [];
    let cur = null;
    for (const it of list) {
      const isBlank = it.str.trim() === '';
      if (cur && Math.abs(it.y - cur.y) <= 0.35 * Math.min(it.h, cur.h)) {
        cur.items.push(it);
      } else if (!isBlank) {
        cur = { y: it.y, h: it.h, items: [it] };
        lines.push(cur);
      }
    }
    for (const line of lines) {
      line.segs = lineSegments(line);
      line.h = Math.max.apply(null, line.segs.map((s) => s.h).concat(line.h));
    }
    return lines.filter((l) => l.segs.length > 0);
  }

  function lineSegments(line) {
    const items = line.items.slice().sort((a, b) => a.x - b.x);
    const pieces = [];
    let pendingSpace = false;

    for (const it of items) {
      if (it.str.trim() === '') {
        pendingSpace = true;
        continue;
      }
      const str = it.str;
      const cw = str.length ? it.w / str.length : 0;
      // Tabs oder drei und mehr Leerzeichen innerhalb eines Textstücks
      // gelten als Spaltenwechsel (mit Leerzeichen ausgerichtete Listen).
      const re = /\t+| {3,}/g;
      let from = 0;
      let first = true;
      const push = (a, b) => {
        const raw = str.slice(a, b);
        const text = raw.trim();
        if (!text) return;
        const lead = raw.length - raw.replace(/^\s+/, '').length;
        pieces.push({
          text,
          x: it.x + (a + lead) * cw,
          xEnd: it.x + (a + lead + text.length) * cw,
          h: it.h,
          font: it.font,
          hard: !first,
          spBefore: pendingSpace || lead > 0,
          spAfter: /\s$/.test(raw),
        });
        pendingSpace = false;
        first = false;
      };
      let m;
      while ((m = re.exec(str))) {
        push(from, m.index);
        from = m.index + m[0].length;
        first = false;
      }
      push(from, str.length);
    }

    const segs = [];
    for (const p of pieces) {
      const last = segs[segs.length - 1];
      if (last && !p.hard) {
        const gap = p.x - last.xEnd;
        const h = Math.max(p.h, last.h);
        if (gap < Math.max(4, 0.6 * h)) {
          const space = last.spAfter || p.spBefore || gap > 0.15 * h;
          last.text += (space ? ' ' : '') + p.text;
          last.xEnd = Math.max(last.xEnd, p.xEnd);
          last.spAfter = p.spAfter;
          last.fonts.push(fontKey(p));
          continue;
        }
      }
      segs.push({
        text: p.text,
        x: p.x,
        xEnd: p.xEnd,
        h: p.h,
        spAfter: p.spAfter,
        fonts: [fontKey(p)],
      });
    }
    for (const s of segs) s.text = clean(s.text);
    return segs.filter((s) => s.text !== '');
  }

  function fontKey(p) {
    return p.font + '@' + Math.round(p.h * 2) / 2;
  }

  // ------------------------------------------------------ Tabellen-Modus

  // Spaltengrenzen einer Seite aus den Zeilen mit genau n Segmenten.
  function columnBounds(refLines, n) {
    const bounds = [];
    for (let k = 1; k < n; k++) {
      const ends = refLines.map((l) => l.segs[k - 1].xEnd);
      const starts = refLines.map((l) => l.segs[k].x);
      const lo = quantile(ends, 0.9);
      const hi = quantile(starts, 0.1);
      let b;
      if (lo < hi) {
        b = (lo + hi) / 2;
      } else {
        // Spalten überlappen (z. B. Tabulator-Listen mit überlangen
        // Einträgen): die häufigste Startposition nehmen.
        b = modeStart(starts) - 2;
      }
      if (bounds.length && b <= bounds[bounds.length - 1]) b = bounds[bounds.length - 1] + 1;
      bounds.push(b);
    }
    return bounds;
  }

  function modeStart(starts) {
    const sorted = starts.slice().sort((a, b) => a - b);
    let best = sorted[0];
    let bestCount = 0;
    for (let i = 0; i < sorted.length; i++) {
      let j = i;
      while (j < sorted.length && sorted[j] - sorted[i] <= 6) j++;
      if (j - i > bestCount) {
        bestCount = j - i;
        best = sorted[i];
      }
    }
    return best;
  }

  function columnCount(pageLines) {
    const counts = new Map();
    let multi = 0;
    for (const lines of pageLines) {
      for (const l of lines) {
        if (l.segs.length < 2) continue;
        multi++;
        counts.set(l.segs.length, (counts.get(l.segs.length) || 0) + 1);
      }
    }
    // Die größte Spaltenzahl, die regelmäßig vorkommt. So zählt auch eine
    // dritte Spalte mit, die nur in manchen Zeilen gefüllt ist.
    const need = Math.max(2, 0.2 * multi);
    let n = 0;
    let modal = 2;
    let modalCount = 0;
    for (const [len, c] of counts) {
      if (c >= need && len > n) n = len;
      if (c > modalCount || (c === modalCount && len < modal)) {
        modal = len;
        modalCount = c;
      }
    }
    return n || modal;
  }

  function tableRows(pageLines) {
    const n = columnCount(pageLines);
    const rows = [];
    let bounds = null;

    pageLines.forEach((lines, pageIndex) => {
      const ref = lines.filter((l) => l.segs.length === n);
      if (ref.length >= 2 || (!bounds && ref.length === 1)) bounds = columnBounds(ref, n);
      if (!bounds || !lines.length) return;

      // 1) Jede Zeile auf die Spalten verteilen.
      const placed = lines.map((l) => {
        const cells = new Array(n).fill('');
        const fonts = new Array(n).fill(null).map(() => new Set());
        for (const s of l.segs) {
          let col = 0;
          while (col < n - 1 && bounds[col] <= s.x) col++;
          cells[col] = joinCell(cells[col], s.text);
          s.fonts.forEach((f) => fonts[col].add(f));
        }
        return { y: l.y, h: l.h, cells, fonts };
      });

      // 2) Zeilenabstände. Deutlich engere Abstände als üblich bedeuten:
      //    Umbruch innerhalb einer Tabellenzeile.
      const gaps = [];
      for (let i = 1; i < placed.length; i++) gaps.push(placed[i].y - placed[i - 1].y);
      const usual = gaps.filter((g, i) => g > 0 && g <= 4 * placed[i + 1].h);
      const typicalGap = usual.length >= 3 ? quantile(usual, 0.5) : 0;

      const blocks = [];
      placed.forEach((p, i) => {
        const gap = i === 0 ? Infinity : gaps[i - 1];
        const last = blocks[blocks.length - 1];
        if (last && typicalGap && gap < 0.8 * typicalGap) {
          mergeInto(last, p);
          last.lastY = p.y;
        } else {
          blocks.push({ cells: p.cells.slice(), fonts: p.fonts, gap, lastY: p.y, h: p.h });
        }
      });
      // Abstand eines Blocks = Abstand seiner ersten Zeile zur letzten
      // Zeile des vorherigen Blocks (steht schon in gap).

      // 3) Blöcke zu Vokabelzeilen: Eine neue Zeile beginnt, wenn die erste
      //    Spalte und mindestens eine weitere gefüllt sind. Alles andere
      //    ist eine Fortsetzung (Umbruch) oder eine Überschrift.
      let cur = null;
      for (const b of blocks) {
        const filled = b.cells.filter(Boolean).length;
        if (b.cells[0] !== '' && filled >= 2) {
          cur = { cells: b.cells, fonts: b.fonts, page: pageIndex };
          rows.push(cur);
        } else if (
          cur &&
          filled >= 1 &&
          b.gap <= 1.4 * (typicalGap || 1.6 * b.h) &&
          sameFonts(cur, b)
        ) {
          mergeInto(cur, b);
        } else {
          cur = null;
        }
      }
    });

    return { rows: rows.map((r) => ({ cells: r.cells, page: r.page })), n };
  }

  function mergeInto(target, src) {
    for (let c = 0; c < src.cells.length; c++) {
      if (!src.cells[c]) continue;
      target.cells[c] = joinCell(target.cells[c], src.cells[c]);
      src.fonts[c].forEach((f) => target.fonts[c].add(f));
    }
  }

  // Eine Fortsetzungszeile benutzt dieselbe Schrift wie die Zelle darüber.
  // Eine fette Zwischenüberschrift ("Unit 3") fällt dadurch heraus.
  function sameFonts(row, block) {
    for (let c = 0; c < block.cells.length; c++) {
      if (!block.cells[c] || row.fonts[c].size === 0) continue;
      let shared = false;
      block.fonts[c].forEach((f) => {
        if (row.fonts[c].has(f)) shared = true;
      });
      if (!shared) return false;
    }
    return true;
  }

  // ---------------------------------------------------- Trennzeichen-Modus

  const SEPARATORS = [
    { name: 'tab', re: /\t+/ },
    { name: 'dash', re: /\s+[–—]\s+/ },
    { name: 'hyphen', re: /\s+-{1,2}\s+/ },
    { name: 'equals', re: /\s*=\s*/ },
    { name: 'arrow', re: /\s*(?:→|⇒|->|=>)\s*/ },
    { name: 'pipe', re: /\s*\|\s*/ },
    { name: 'colon', re: /\s*:\s+/ },
    { name: 'semicolon', re: /\s*;\s*/ },
  ];
  const COMMA = { name: 'comma', re: /\s*,\s*/ };

  function detectSeparator(texts) {
    let best = null;
    let bestCount = 0;
    for (const sep of SEPARATORS) {
      let count = 0;
      for (const t of texts) if (splitAt(t, sep)) count++;
      if (count > bestCount) {
        best = sep;
        bestCount = count;
      }
    }
    if (!best && texts.length) {
      // Komma nur, wenn fast jede Zeile genau eines enthält ("house, Haus").
      const one = texts.filter((t) => (t.match(/,/g) || []).length === 1 && splitAt(t, COMMA)).length;
      if (one >= 2 && one >= 0.8 * texts.length) return { sep: COMMA, count: one };
    }
    return { sep: best, count: bestCount };
  }

  // Teilt am ersten Vorkommen; null, wenn eine Seite leer bliebe.
  function splitAt(text, sep) {
    if (sep.name === 'tab') {
      const parts = text.split(sep.re).map(clean).filter(Boolean);
      return parts.length >= 2 ? parts : null;
    }
    const m = sep.re.exec(text);
    if (!m) return null;
    const left = clean(text.slice(0, m.index));
    const right = clean(text.slice(m.index + m[0].length));
    return left && right ? [left, right] : null;
  }

  function separatorRows(texts, sep) {
    const rows = [];
    for (const t of texts) {
      const parts = splitAt(stripBullet(t), sep) || splitAt(t, sep);
      if (parts) rows.push({ cells: parts, page: 0 });
    }
    return rows;
  }

  function stripBullet(t) {
    return t.replace(/^\s*(?:\(?\d{1,4}[.)]|[•●▪■◦·*]|[-–]\s)\s*/, '');
  }

  // ------------------------------------------------------ Nachbearbeitung

  const JUNK_CELL = /^(?:\(?\d{1,4}[.)]?|[-–—=:→|•●*·]+)$/;
  const HEAD_EN = /^(?:englisch\w*|english|engl\.?|en|eng)(?![\wäöüß])/i;
  const HEAD_DE = /^(?:deutsch\w*|german|dt\.?|de|ger|deu)(?![\wäöüß])/i;
  const HEAD_TITLE = /^(?:vokabel|vokabeln|wort|wörter|word|words|übersetzung|translation|bedeutung|meaning|beispiel|beispiele|beispielsatz|example|examples|example sentence|note|notes|anmerkung|anmerkungen|bemerkung|bemerkungen|hinweis|hinweise|comment|comments|wortart|part of speech|nr\.?|no\.?)$/i;
  // "Example / note", "Beispiel & Hinweis": jeder Teil ist ein Spaltentitel.
  const HEAD_GENERIC = {
    test: (v) => v.split(/\s*[\/&,+]\s*|\s+(?:and|und|or|oder)\s+/i).every((part) => HEAD_TITLE.test(part.trim())),
  };

  // Spaltentitel sind kurz: "Englisch", "English word", "Deutsche Bedeutung".
  function isHead(re, value) {
    return re.test(value) && value.split(/\s+/).length <= 3;
  }

  function finish(rows, mode, rawText) {
    let n = rows.reduce((m, r) => Math.max(m, r.cells.length), 0);
    rows.forEach((r) => {
      r.cells = r.cells.map(clean);
      while (r.cells.length < n) r.cells.push('');
    });

    // Spalten entfernen, die nur Nummern oder Trennstriche enthalten.
    for (let c = n - 1; c >= 0 && n > 2; c--) {
      const filled = rows.map((r) => r.cells[c]).filter(Boolean);
      const junk = filled.filter((v) => JUNK_CELL.test(v)).length;
      if (filled.length === 0 || junk >= 0.8 * filled.length) {
        rows.forEach((r) => r.cells.splice(c, 1));
        n--;
      }
    }

    // Kopfzeilen ("Englisch | Deutsch") verraten die Sprachen und fliegen raus.
    // Vorsicht: "example | Beispiel" oder "German | Deutsch" können auch
    // ganz normale Vokabeln sein. Als Kopfzeile gilt deshalb nur
    //  - eine Zeile, die Englisch UND Deutsch nennt, oder
    //  - die erste Zeile einer Seite aus lauter Spaltentiteln.
    const hints = {};
    const firstOnPage = new Set();
    let lastPage = null;
    rows.forEach((r) => {
      if (r.page !== lastPage) firstOnPage.add(r);
      lastPage = r.page;
    });
    rows = rows.filter((r) => {
      const cells = r.cells.filter(Boolean);
      if (cells.length < 2 || cells.some((v) => v.length > 30)) return true;
      const enCols = [];
      const deCols = [];
      let titles = 0;
      r.cells.forEach((v, c) => {
        if (!v) return;
        if (isHead(HEAD_EN, v)) enCols.push(c);
        else if (isHead(HEAD_DE, v)) deCols.push(c);
        else if (HEAD_GENERIC.test(v)) titles++;
      });
      if (enCols.length + deCols.length + titles !== cells.length) return true;
      const namesBoth = enCols.length >= 1 && deCols.length >= 1;
      const titleRow = firstOnPage.has(r) && enCols.length + deCols.length <= 1;
      if (!namesBoth && !titleRow) return true;
      if (hints.en == null && enCols.length) hints.en = enCols[0];
      if (hints.de == null && deCols.length) hints.de = deCols[0];
      return false;
    });

    // Aufzählungsnummern am Anfang der ersten Spalte entfernen.
    const numbered = rows.filter((r) => /^\(?\d{1,4}[.)]\s+\S/.test(r.cells[0])).length;
    if (rows.length && numbered >= 0.6 * rows.length) {
      rows.forEach((r) => {
        r.cells[0] = r.cells[0].replace(/^\(?\d{1,4}[.)]\s+/, '');
      });
    }

    rows = rows.filter((r) => r.cells.filter(Boolean).length >= 2);

    let guess = guessColumns(rows, n, hints);

    // Zwei Vokabeltabellen nebeneinander (EN | DE | EN | DE) untereinander
    // hängen: erst die linke Hälfte jeder Seite, dann die rechte.
    if (n >= 4 && n % 2 === 0 && hints.en == null && hints.de == null) {
      const folded = foldSideBySide(rows, n, guess.scores);
      if (folded) {
        rows = folded;
        n = 2;
        guess = guessColumns(rows, n, {});
      }
    }

    return {
      mode,
      columnCount: n,
      rows: rows.map((r) => r.cells),
      en: guess.en,
      de: guess.de,
      confident: guess.confident,
      rawText: rawText || '',
    };
  }

  function foldSideBySide(rows, n, scores) {
    const sign = scores.map((s) => (s > 0.25 ? 1 : s < -0.25 ? -1 : 0));
    for (let c = 0; c < n; c++) {
      if (sign[c] === 0) return null;
      if (c >= 2 && sign[c] !== sign[c - 2]) return null;
    }
    if (sign[0] === sign[1]) return null;

    const out = [];
    const pages = Array.from(new Set(rows.map((r) => r.page)));
    for (const page of pages) {
      const onPage = rows.filter((r) => r.page === page);
      for (let c = 0; c < n; c += 2) {
        for (const r of onPage) {
          if (r.cells[c] && r.cells[c + 1]) out.push({ cells: [r.cells[c], r.cells[c + 1]], page });
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------ Spracherkennung

  const DE_WORDS = new Set(
    ('der die das den dem des ein eine einen einem einer eines sich etw etwas jdn jdm jmd jmdn jmdm ' +
      'jemand jemanden jemandem und oder nicht kein keine mit auf für von zu zum zur im am bei nach ' +
      'über unter vor aus um durch gegen ohne ist sind sein haben hat werden wird ich du er wir ihr ' +
      'sie es man als wie auch nur noch sehr machen gehen ugs').split(' ')
  );
  const EN_WORDS = new Set(
    ('the a to of sth sb smth something somebody someone and or not no with on for from at by be is ' +
      'are was were have has do does it you he she we they this that these those your my his her ' +
      'up out off about into than there what which who when where why how if').split(' ')
  );
  const DE_SUFFIX = /(?:ung|keit|heit|schaft|lich|isch|chen|ieren|tät|nis|eln|ern)$/;
  const EN_SUFFIX = /(?:tion|sion|ing|ly|ness|ment|ous|ity|ful|less|able|ible|ship|ance|ence)$/;

  // > 0: eher Deutsch, < 0: eher Englisch.
  function scoreLang(text) {
    let score = 0;
    if (/[äöüßÄÖÜ]/.test(text)) score += 2;
    if (/^to\s+[a-z]/.test(text)) score -= 1.5;
    const tokens = text.split(/[^A-Za-zÀ-ÿ']+/).filter(Boolean);
    tokens.forEach((raw, i) => {
      const t = raw.toLowerCase();
      if (DE_WORDS.has(t)) score += 1;
      if (EN_WORDS.has(t)) score -= 1;
      if (t.length >= 5) {
        if (DE_SUFFIX.test(t)) score += 0.75;
        if (EN_SUFFIX.test(t)) score -= 0.75;
      }
      if (/sch|tz|pf|ei|eu|äu/.test(t)) score += 0.25;
      if (/th|wh|gh|ou|ea|oo|y$/.test(t)) score -= 0.25;
      // Großgeschriebene Wörter mitten im Eintrag sind meist deutsche Nomen.
      if (i > 0 && /^[A-ZÄÖÜ][a-zäöüß]/.test(raw)) score += 0.5;
    });
    return score;
  }

  function guessColumns(rows, n, hints) {
    const scores = [];
    const numeric = [];
    for (let c = 0; c < n; c++) {
      const cells = rows.map((r) => (r.cells || r)[c]).filter(Boolean);
      const sum = cells.reduce((s, v) => s + scoreLang(v), 0);
      scores.push(cells.length ? sum / cells.length : 0);
      numeric.push(cells.length ? cells.filter((v) => JUNK_CELL.test(v)).length / cells.length : 1);
    }
    hints = hints || {};
    let en = hints.en;
    let de = hints.de;
    let confident = en != null && de != null;

    if (n < 2) return { en: 0, de: 0, confident: false, scores };

    if (de == null) {
      let best = -Infinity;
      for (let c = 0; c < n; c++) {
        if (c === en || numeric[c] > 0.5) continue;
        if (scores[c] > best) {
          best = scores[c];
          de = c;
        }
      }
      if (de == null) de = en === 1 ? 0 : 1;
    }
    if (en == null) {
      // Die erste Spalte links, die nicht die deutsche ist (dahinter stehen
      // oft Beispielsätze, die ebenfalls englisch sind).
      for (let c = 0; c < n; c++) {
        if (c === de || numeric[c] > 0.5) continue;
        en = c;
        break;
      }
      if (en == null) en = de === 0 ? 1 : 0;
    }
    if (!confident) {
      confident = scores[de] - scores[en] >= 0.3;
      if (!confident && hints.en == null && hints.de == null) {
        // Keine klaren Anzeichen: übliche Reihenfolge Englisch | Deutsch.
        en = 0;
        de = 1;
      }
    }
    return { en, de, confident, scores };
  }

  // ------------------------------------------------------------ Einstieg

  function rawTextOf(pageLines) {
    return pageLines
      .map((lines) => lines.map((l) => l.segs.map((s) => s.text).join('\t')).join('\n'))
      .filter(Boolean)
      .join('\n');
  }

  // pages: Array von Seiten, jede ein Array von Textstücken.
  function parsePages(pages) {
    const pageLines = (pages || []).map(buildLines);
    const all = [].concat.apply([], pageLines);
    const rawText = rawTextOf(pageLines);
    const multi = all.filter((l) => l.segs.length >= 2).length;
    const singles = all.filter((l) => l.segs.length === 1).map((l) => l.segs[0].text);
    const sep = detectSeparator(singles);

    if (multi >= 2 && multi >= sep.count) {
      return finish(tableRows(pageLines).rows, 'table', rawText);
    }
    if (sep.sep && sep.count >= 2) {
      const texts = all.map((l) => l.segs.map((s) => s.text).join(' '));
      return finish(separatorRows(texts, sep.sep), 'separator', rawText);
    }
    return finish([], 'none', rawText);
  }

  // Eingefügter oder getippter Text: eine Vokabel pro Zeile.
  function parseText(text) {
    const texts = String(text || '')
      .split(/\r?\n/)
      .map((t) => t.replace(/ /g, ' '))
      .filter((t) => t.trim() !== '');
    let sep = detectSeparator(texts);
    if (!sep.sep) {
      // Letzter Versuch: mehrere Leerzeichen als Spaltentrenner.
      const spaces = { name: 'spaces', re: / {2,}/ };
      const count = texts.filter((t) => splitAt(t.trim(), spaces)).length;
      if (count) sep = { sep: spaces, count };
    }
    const rows = sep.sep ? separatorRows(texts, sep.sep) : [];
    return finish(rows, sep.sep ? 'separator' : 'none', texts.join('\n'));
  }

  // Macht aus der erkannten Tabelle Vokabelpaare für die gewählten Spalten.
  function toPairs(rows, en, de) {
    const pairs = [];
    for (const r of rows || []) {
      const e = clean(r[en]);
      const d = clean(r[de]);
      if (e && d) pairs.push({ en: e, de: d });
    }
    return pairs;
  }

  return { parsePages, parseText, toPairs, scoreLang, buildLines };
});
