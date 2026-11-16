/*
 * Oberfläche des Vokabeltrainers.
 *
 * Ansichten: Start (Listen) -> Liste -> Übungsrunde -> Auswertung,
 * dazu der Import (PDF oder Text) mit Kontrollansicht.
 * Jede Ansicht ist eine Funktion, die einen DOM-Knoten baut; render()
 * setzt die aktuelle Ansicht ein. Texte aus PDFs landen nur über
 * textContent / value im Dokument, nie als HTML.
 */
(function () {
  'use strict';

  const Parser = window.VokabelParser;
  const Trainer = window.VokabelTrainer;
  const Store = window.VokabelStore;
  const Pdf = window.VokabelPdf;
  const root = document.getElementById('app');
  const HARD = '__schwer__'; // Kennung der Sammelliste "Schwere Vokabeln"

  // ------------------------------------------------------------ DOM-Helfer

  const AS_ATTRIBUTE = new Set([
    'role', 'for', 'lang', 'autocapitalize', 'autocorrect', 'autocomplete', 'enterkeyhint',
    'inputmode', 'spellcheck', 'accept', 'name', 'rows', 'type', 'scope',
  ]);

  function h(tag, props) {
    const el = document.createElement(tag);
    for (const key in props || {}) {
      const value = props[key];
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key.slice(0, 2) === 'on') el.addEventListener(key.slice(2), value);
      else if (key.indexOf('-') !== -1 || AS_ATTRIBUTE.has(key)) el.setAttribute(key, value === true ? '' : value);
      else el[key] = value;
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  // Ersetzt den Inhalt eines Elements (null und Listen sind erlaubt).
  function fill(el) {
    el.replaceChildren();
    for (let i = 1; i < arguments.length; i++) append(el, arguments[i]);
  }

  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach((c) => append(el, c));
    else el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  const PATHS = {
    star: 'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z',
    back: 'M15 5l-7 7 7 7',
    close: 'M6 6l12 12M18 6L6 18',
    upload: 'M12 16V5m0 0L8 9m4-4l4 4M5 19h14',
    edit: 'M4 20h4L19 9l-4-4L4 16v4z',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
    plus: 'M12 5v14M5 12h14',
    swap: 'M7 8h12m0 0l-3-3m3 3l-3 3M17 16H5m0 0l3 3m-3-3l3-3',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    arrow: 'M5 12h14m0 0l-5-5m5 5l-5 5',
  };

  function icon(name, filled) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', PATHS[name]);
    path.setAttribute('fill', filled ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.9');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function count(n) {
    return n === 1 ? '1 Vokabel' : n + ' Vokabeln';
  }

  // Eingabefelder für Vokabeln: keine Autokorrektur, sonst "verbessert"
  // das Handy genau das, was geübt werden soll.
  function wordInput(props) {
    return h('input', Object.assign({
      type: 'text',
      autocomplete: 'off',
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: 'false',
    }, props));
  }

  // ------------------------------------------------------------------ Daten

  let data = Store.load() || { version: 1, seeded: false, builtins: [], lists: [] };
  data.seeded = true;
  if (addBuiltins(data)) Store.save(data);

  // Legt eingebaute Listen an, die es in diesem Browser noch nie gab.
  // Gibt zurück, ob etwas hinzugekommen ist.
  function addBuiltins(target) {
    let added = false;
    (window.VokabelBuiltins || []).slice().reverse().forEach((b) => {
      if (target.builtins.indexOf(b.id) !== -1) return;
      target.builtins.push(b.id);
      if (target.lists.some((l) => l.id === b.id)) return;
      // updated: 0 = unverändert. Eine gespeicherte Fassung (z. B. mit
      // Sternen) in der Cloud ist immer neuer und gewinnt beim Abgleich.
      target.lists.unshift({
        id: b.id,
        name: b.name,
        created: Date.now(),
        updated: 0,
        words: b.words.map((w, i) => ({ id: b.id + '-' + i, en: w[0], de: w[1], hard: false })),
      });
      added = true;
    });
    return added;
  }

  function findList(id) {
    return data.lists.find((l) => l.id === id) || null;
  }

  function touch(list) {
    if (list) list.updated = Date.now();
    Store.save(data);
  }

  function hardEntries() {
    const out = [];
    data.lists.forEach((list) => list.words.forEach((word) => {
      if (word.hard) out.push({ word, list });
    }));
    return out;
  }

  // source: { listId, scope: 'all' | 'hard' }
  function entriesFor(source) {
    if (source.listId === HARD) return hardEntries();
    const list = findList(source.listId);
    if (!list) return [];
    return list.words
      .filter((w) => source.scope !== 'hard' || w.hard)
      .map((word) => ({ word, list }));
  }

  // ------------------------------------------------------------- Navigation

  let view = { name: 'home' };
  let flash = null; // einmalige Meldung oben in der nächsten Ansicht
  let leave = null; // Aufräumfunktion der aktuellen Ansicht
  let storageStatus = Store.isAvailable() ? 'local' : 'none';
  let pendingMerge = null;

  const BUSY = new Set(['session', 'summary', 'review', 'text', 'loading']);

  function go(next) {
    view = next;
    if (pendingMerge && !BUSY.has(view.name)) applyMerge();
    render();
    window.scrollTo(0, 0);
  }

  function render(opts) {
    opts = opts || {};
    if (leave) {
      leave();
      leave = null;
    }
    const scrollY = window.scrollY;
    const active = document.activeElement;
    const focusKey = opts.focusKey || (active && active.getAttribute && active.getAttribute('data-key'));

    const node = VIEWS[view.name]();
    if (flash) {
      node.insertBefore(h('p', { class: 'notice notice-' + flash.kind, role: 'status' }, flash.text), node.firstChild);
      flash = null;
    }
    root.replaceChildren(node, footer());

    if (opts.keepScroll) window.scrollTo(0, scrollY);
    let target = null;
    if (opts.keepScroll && focusKey) {
      target = Array.from(root.querySelectorAll('[data-key]')).find((el) => el.getAttribute('data-key') === focusKey) || null;
    }
    if (!target && !opts.keepScroll) target = root.querySelector('[data-autofocus]');
    if (target) target.focus({ preventScroll: !!opts.keepScroll });
  }

  function footer() {
    const text = {
      local: 'Deine Vokabeln sind in diesem Browser auf diesem Gerät gespeichert.',
      cloud: 'Deine Vokabeln sind in deinem Claude-Konto gespeichert.',
      pending: 'Verbindung zum Speicher wird hergestellt …',
      none: 'Achtung: Dieser Browser erlaubt kein Speichern. Die Vokabeln gehen verloren, wenn du die Seite schließt.',
    }[storageStatus];
    return h('footer', { class: 'app-footer' + (storageStatus === 'none' ? ' is-warning' : '') }, text);
  }

  // ------------------------------------------------------------------ Start

  function homeView() {
    const hard = hardEntries();
    const hardLists = new Set(hard.map((e) => e.list.id)).size;

    return h('div', { class: 'view' },
      h('section', { class: 'hard-banner' + (hard.length ? '' : ' is-empty'), 'aria-labelledby': 'hard-title' },
        h('div', { class: 'hard-banner-text' },
          h('h2', { id: 'hard-title' }, h('span', { class: 'marker' }, 'Schwere Vokabeln')),
          h('p', null, hard.length
            ? count(hard.length) + ' markiert' + (hardLists > 1 ? ' in ' + hardLists + ' Listen' : '')
            : 'Tippe bei einer Vokabel auf den Stern. Markierte Vokabeln kannst du hier gesondert üben.')
        ),
        hard.length
          ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go({ name: 'list', id: HARD }) },
            'Gesondert üben', icon('arrow'))
          : null
      ),

      h('section', { 'aria-labelledby': 'lists-title' },
        h('h2', { id: 'lists-title' }, 'Meine Listen'),
        data.lists.length
          ? h('ul', { class: 'list-cards' }, data.lists.map((list) => {
            const hardCount = list.words.filter((w) => w.hard).length;
            return h('li', null,
              h('button', { class: 'list-card', type: 'button', onclick: () => go({ name: 'list', id: list.id }) },
                h('span', { class: 'list-card-name' }, list.name),
                h('span', { class: 'list-card-meta' },
                  count(list.words.length),
                  hardCount ? h('span', { class: 'chip chip-hard' }, icon('star', true), hardCount + ' schwer') : null
                ),
                icon('arrow')
              )
            );
          }))
          : h('p', { class: 'muted' }, 'Noch keine Liste. Lade unten eine PDF hoch oder tippe Vokabeln ein.')
      ),

      h('section', { 'aria-labelledby': 'import-title' },
        h('h2', { id: 'import-title' }, 'Neue Vokabeln'),
        importBox(null)
      )
    );
  }

  // Hochladefläche; targetId = Liste, in die importiert wird (oder null).
  function importBox(targetId) {
    const fileInput = h('input', {
      type: 'file',
      id: 'pdf-file',
      accept: 'application/pdf,.pdf',
      class: 'visually-hidden',
      tabIndex: -1,
      'aria-hidden': 'true',
      onchange: (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        importPdf(file, targetId);
      },
    });
    const zone = h('div', { class: 'dropzone' },
      h('div', { class: 'dropzone-text' },
        h('p', { class: 'dropzone-title' }, targetId ? 'Weitere Vokabeln hinzufügen' : 'PDF mit Vokabeln hochladen'),
        h('p', { class: 'muted' },
          'Die PDF wird direkt auf deinem Gerät ausgelesen. Danach prüfst du die erkannten Vokabeln, bevor sie gespeichert werden.')
      ),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => fileInput.click() },
          icon('upload'), 'PDF auswählen'),
        h('button', { class: 'btn', type: 'button', onclick: () => go({ name: 'text', targetId, back: view }) },
          'Vokabeln eintippen'),
        fileInput
      )
    );
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      importPdf(file, targetId);
    });
    return zone;
  }

  // ----------------------------------------------------------------- Import

  async function importPdf(file, targetId) {
    if (!file) return;
    const back = view;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      flash = { kind: 'error', text: '„' + file.name + '“ ist keine PDF-Datei. Bitte wähle eine PDF aus.' };
      go(back);
      return;
    }
    go({ name: 'loading', text: 'PDF wird gelesen …' });
    try {
      const pages = await Pdf.extractPages(file, (page, total) => {
        const el = document.getElementById('loading-text');
        if (el && total > 1) el.textContent = 'Seite ' + page + ' von ' + total + ' wird gelesen …';
      });
      const result = Parser.parsePages(pages);
      openReview(result, { fileName: file.name, targetId, back });
    } catch (err) {
      const text = {
        'pdf-password': 'Diese PDF ist mit einem Passwort geschützt und kann nicht gelesen werden.',
        'pdf-invalid': 'Die Datei konnte nicht als PDF gelesen werden. Vielleicht ist sie beschädigt.',
        'pdfjs-load': 'Der PDF-Leser konnte nicht geladen werden. Prüfe deine Internetverbindung und versuche es noch einmal.',
      }[err && err.message] || 'Beim Lesen der PDF ist ein Fehler aufgetreten. Versuche es noch einmal.';
      flash = { kind: 'error', text };
      go(back);
    }
  }

  function openReview(result, ctx) {
    const pairs = Parser.toPairs(result.rows, result.en, result.de);
    if (!pairs.length) {
      const hasText = result.rawText.trim() !== '';
      let hint;
      if (ctx.fromText) {
        hint = 'Ich habe keine Vokabelpaare gefunden. Schreibe pro Zeile eine Vokabel, zum Beispiel: house – das Haus';
      } else if (hasText) {
        hint = 'In „' + ctx.fileName + '“ habe ich keine Vokabelpaare erkannt. Unten steht der Text aus der PDF. ' +
          'Bring ihn in die Form „englisch – deutsch“, eine Vokabel pro Zeile.';
      } else {
        hint = 'In „' + ctx.fileName + '“ steht kein auslesbarer Text. Vermutlich ist die PDF eingescannt oder ein Foto. ' +
          'Du kannst die Vokabeln hier eintippen oder einfügen.';
      }
      go({ name: 'text', targetId: ctx.targetId, back: ctx.back, text: ctx.fromText ? ctx.text : result.rawText, hint });
      return;
    }
    const baseName = ctx.fileName ? ctx.fileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim() : '';
    go({
      name: 'review',
      rows: result.rows,
      columnCount: result.columnCount,
      en: result.en,
      de: result.de,
      confident: result.confident,
      pairs,
      fileName: ctx.fileName || null,
      listName: baseName || 'Neue Liste',
      target: ctx.targetId && findList(ctx.targetId) ? ctx.targetId : 'new',
      back: ctx.back,
    });
  }

  function loadingView() {
    return h('div', { class: 'view view-loading', role: 'status' },
      h('div', { class: 'spinner', 'aria-hidden': 'true' }),
      h('p', { id: 'loading-text' }, view.text)
    );
  }

  function backTarget(v) {
    const back = v.back;
    if (back && back.name === 'list' && (back.id === HARD || findList(back.id))) return { name: 'list', id: back.id, scope: back.scope };
    return { name: 'home' };
  }

  function textView() {
    const v = view;
    const area = h('textarea', {
      id: 'vocab-text',
      rows: '12',
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: 'false',
      placeholder: 'house – das Haus\nto go – gehen\ntree – der Baum',
      value: v.text || '',
      'data-autofocus': true,
    });
    const submit = (e) => {
      e.preventDefault();
      const result = Parser.parseText(area.value);
      openReview(result, { targetId: v.targetId, back: v.back, fromText: true, text: area.value });
    };
    return h('div', { class: 'view' },
      h('button', { class: 'back-link', type: 'button', onclick: () => go(backTarget(v)) }, icon('back'), 'Zurück'),
      h('h1', null, 'Vokabeln eintippen'),
      v.hint ? h('p', { class: 'notice notice-info' }, v.hint) : null,
      h('form', { class: 'stack', onsubmit: submit },
        h('label', { for: 'vocab-text' },
          'Eine Vokabel pro Zeile, erst Englisch, dann Deutsch. Als Trennzeichen gehen Gedankenstrich, Gleichheitszeichen, Doppelpunkt, Semikolon oder Tabulator.'),
        area,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-primary', type: 'submit' }, 'Weiter zur Kontrolle'),
          h('button', { class: 'btn', type: 'button', onclick: () => go(backTarget(v)) }, 'Abbrechen')
        )
      )
    );
  }

  function reviewView() {
    const v = view;
    const valid = () => v.pairs.filter((p) => p.en.trim() && p.de.trim()).length;
    const saveBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: saveReview });
    const paintSave = () => {
      saveBtn.textContent = count(valid()) + ' speichern';
      saveBtn.disabled = valid() === 0;
    };
    paintSave();

    const swap = () => {
      v.pairs.forEach((p) => {
        const t = p.en;
        p.en = p.de;
        p.de = t;
      });
      const t = v.en;
      v.en = v.de;
      v.de = t;
      v.confident = true;
      render({ keepScroll: true });
    };

    const columnSelect = (which, label) => {
      const select = h('select', {
        id: 'col-' + which,
        onchange: (e) => {
          const other = which === 'en' ? 'de' : 'en';
          const picked = Number(e.target.value);
          if (picked === v[other]) v[other] = v[which];
          v[which] = picked;
          v.pairs = Parser.toPairs(v.rows, v.en, v.de);
          v.confident = true;
          render({ keepScroll: true });
        },
      });
      for (let c = 0; c < v.columnCount; c++) {
        const sample = v.rows.map((r) => r[c]).filter(Boolean).slice(0, 2).join(', ');
        const text = 'Spalte ' + (c + 1) + (sample ? ': ' + (sample.length > 34 ? sample.slice(0, 34) + '…' : sample) : '');
        select.appendChild(h('option', { value: String(c), selected: c === v[which] }, text));
      }
      return h('div', { class: 'field' }, h('label', { for: 'col-' + which }, label), select);
    };

    const rows = v.pairs.map((p, i) => h('li', { class: 'pair-row' + (Math.max(p.en.length, p.de.length) > 17 ? ' is-long' : '') },
      wordInput({
        id: 'rv-en-' + i,
        lang: 'en',
        value: p.en,
        'aria-label': 'Englisch, Zeile ' + (i + 1),
        'data-key': 'rv-en-' + i,
        oninput: (e) => {
          p.en = e.target.value;
          paintSave();
        },
      }),
      wordInput({
        id: 'rv-de-' + i,
        lang: 'de',
        value: p.de,
        'aria-label': 'Deutsch, Zeile ' + (i + 1),
        oninput: (e) => {
          p.de = e.target.value;
          paintSave();
        },
      }),
      h('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': 'Zeile ' + (i + 1) + ' löschen',
        onclick: () => {
          v.pairs.splice(i, 1);
          render({ keepScroll: true });
        },
      }, icon('trash'))
    ));

    const targetSelect = h('select', {
      id: 'rv-target',
      onchange: (e) => {
        v.target = e.target.value;
        render({ keepScroll: true, focusKey: 'rv-target' });
      },
      'data-key': 'rv-target',
    }, h('option', { value: 'new', selected: v.target === 'new' }, 'Neue Liste'),
    data.lists.map((l) => h('option', { value: l.id, selected: v.target === l.id }, l.name)));

    function saveReview() {
      const pairs = v.pairs
        .map((p) => ({ en: p.en.replace(/\s+/g, ' ').trim(), de: p.de.replace(/\s+/g, ' ').trim() }))
        .filter((p) => p.en && p.de);
      if (!pairs.length) return;
      let list = v.target === 'new' ? null : findList(v.target);
      if (!list) {
        const now = Date.now();
        list = { id: Store.newId(), name: v.listName.trim() || 'Neue Liste', created: now, updated: now, words: [] };
        data.lists.unshift(list);
      }
      const key = (w) => (w.en + '\u0000' + w.de).toLowerCase();
      const seen = new Set(list.words.map(key));
      let added = 0;
      pairs.forEach((p) => {
        if (seen.has(key(p))) return;
        seen.add(key(p));
        list.words.push({ id: Store.newId(), en: p.en, de: p.de, hard: false });
        added++;
      });
      touch(list);
      const skipped = pairs.length - added;
      flash = {
        kind: 'ok',
        text: count(added) + ' gespeichert.' + (skipped ? ' ' + skipped + ' doppelte übersprungen.' : ''),
      };
      go({ name: 'list', id: list.id });
    }

    return h('div', { class: 'view' },
      h('button', { class: 'back-link', type: 'button', onclick: () => go(backTarget(v)) }, icon('back'), 'Abbrechen'),
      h('h1', null, 'Vokabeln prüfen'),
      h('p', { class: 'lead' },
        (v.fileName ? 'Aus „' + v.fileName + '“ erkannt: ' : 'Erkannt: ') + count(v.pairs.length) +
        '. Schau kurz drüber. Du kannst jede Zeile ändern oder löschen.'),
      v.confident ? null : h('p', { class: 'notice notice-info' },
        'Ich bin nicht sicher, welche Spalte Englisch ist. Steht Deutsch links, tippe auf „Sprachen tauschen“.'),

      h('div', { class: 'review-tools' },
        data.lists.length ? h('div', { class: 'field' }, h('label', { for: 'rv-target' }, 'Speichern in'), targetSelect) : null,
        v.target === 'new' ? h('div', { class: 'field' },
          h('label', { for: 'rv-name' }, 'Name der Liste'),
          h('input', {
            id: 'rv-name',
            type: 'text',
            autocomplete: 'off',
            value: v.listName,
            oninput: (e) => {
              v.listName = e.target.value;
            },
          })) : null
      ),
      h('div', { class: 'review-tools' },
        v.columnCount > 2 ? [columnSelect('en', 'Englisch steht in'), columnSelect('de', 'Deutsch steht in')] : null,
        h('button', { class: 'btn', type: 'button', onclick: swap, 'data-key': 'rv-swap' }, icon('swap'), 'Sprachen tauschen')
      ),

      h('div', { class: 'pair-head', 'aria-hidden': 'true' }, h('span', null, 'Englisch'), h('span', null, 'Deutsch'), h('span')),
      h('ul', { class: 'pair-list' }, rows),
      h('button', {
        class: 'btn btn-quiet',
        type: 'button',
        onclick: () => {
          v.pairs.push({ en: '', de: '' });
          render({ keepScroll: true, focusKey: 'rv-en-' + (v.pairs.length - 1) });
        },
      }, icon('plus'), 'Zeile hinzufügen'),

      h('div', { class: 'btn-row sticky-actions' },
        saveBtn,
        h('button', { class: 'btn', type: 'button', onclick: () => go(backTarget(v)) }, 'Abbrechen')
      )
    );
  }

  // ------------------------------------------------------------------ Liste

  // Stern-Schalter. compact: nur das Symbol (für Tabellenzeilen).
  function hardToggle(entry, opts) {
    opts = opts || {};
    const btn = h('button', {
      type: 'button',
      class: 'hard-toggle' + (opts.compact ? ' is-compact' : ''),
      'data-key': 'hard-' + entry.word.id,
      onclick: () => {
        entry.word.hard = !entry.word.hard;
        touch(entry.list);
        paint();
        if (opts.onChange) opts.onChange();
      },
    });
    function paint() {
      const hard = entry.word.hard;
      btn.classList.toggle('is-hard', hard);
      btn.setAttribute('aria-pressed', String(hard));
      if (opts.compact) {
        btn.setAttribute('aria-label', '„' + entry.word.en + '“ als schwer markieren');
        btn.replaceChildren(icon('star', hard));
      } else {
        btn.replaceChildren(icon('star', hard), h('span', null, hard ? 'Als schwer markiert' : 'Als schwer markieren'));
      }
    }
    paint();
    return btn;
  }

  function listView() {
    const v = view;
    const isHard = v.id === HARD;
    const list = isHard ? null : findList(v.id);
    if (!isHard && !list) {
      view = { name: 'home' };
      return homeView();
    }
    const entries = isHard ? hardEntries() : list.words.map((word) => ({ word, list }));
    const hardCount = entries.filter((e) => e.word.hard).length;
    const scope = isHard ? 'hard' : v.scope === 'hard' ? 'hard' : 'all';
    const practiceCount = scope === 'hard' ? hardCount : entries.length;
    const source = { listId: v.id, scope };
    const rerender = (focusKey) => render({ keepScroll: true, focusKey });

    // --- Kopf
    let title;
    if (v.renaming && list) {
      const input = h('input', { id: 'list-name', type: 'text', autocomplete: 'off', value: list.name, 'data-key': 'list-name', 'aria-label': 'Name der Liste' });
      title = h('form', {
        class: 'rename-form',
        onsubmit: (e) => {
          e.preventDefault();
          const name = input.value.trim();
          if (name) {
            list.name = name;
            touch(list);
          }
          v.renaming = false;
          rerender('rename');
        },
      }, input, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Speichern'));
    } else {
      title = h('div', { class: 'title-row' },
        h('h1', null, isHard ? h('span', { class: 'marker' }, 'Schwere Vokabeln') : list.name),
        list ? h('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': 'Liste umbenennen',
          'data-key': 'rename',
          onclick: () => {
            v.renaming = true;
            rerender('list-name');
          },
        }, icon('edit')) : null
      );
    }

    // --- Üben
    const scopeOption = (value, label, n) => h('label', { class: 'segment' + (scope === value ? ' is-active' : '') },
      h('input', {
        type: 'radio',
        name: 'scope',
        value,
        checked: scope === value,
        class: 'visually-hidden',
        'data-key': 'scope-' + value,
        onchange: () => {
          v.scope = value;
          rerender('scope-' + value);
        },
      }),
      h('span', null, label),
      h('span', { class: 'segment-count' }, String(n))
    );

    const modeButton = (kicker, label, mode, dir) => h('button', {
      class: 'mode',
      type: 'button',
      disabled: practiceCount === 0,
      onclick: () => startSession(mode, dir, source),
    }, h('span', { class: 'mode-kicker' }, kicker), h('span', { class: 'mode-label' }, label));

    const practice = h('section', { class: 'panel', 'aria-labelledby': 'practice-title' },
      h('h2', { id: 'practice-title' }, 'Üben'),
      isHard ? null : h('fieldset', { class: 'segments' },
        h('legend', { class: 'visually-hidden' }, 'Welche Vokabeln üben?'),
        scopeOption('all', 'Alle Vokabeln', entries.length),
        scopeOption('hard', 'Nur schwere', hardCount)
      ),
      h('div', { class: 'modes' },
        modeButton('Karteikarten', 'Deutsch → Englisch', 'cards', 'de-en'),
        modeButton('Karteikarten', 'Englisch → Deutsch', 'cards', 'en-de'),
        modeButton('Schreiben', 'Englisch tippen', 'write', 'de-en')
      ),
      practiceCount === 0 ? h('p', { class: 'muted' }, scope === 'hard'
        ? 'Noch keine Vokabel als schwer markiert. Tippe unten auf den Stern neben einer Vokabel.'
        : 'Diese Liste ist noch leer. Füge unten Vokabeln hinzu.') : null
    );

    // --- Vokabeln
    const row = (entry) => {
      const w = entry.word;
      if (v.editId === w.id) {
        const en = wordInput({ id: 'edit-en', lang: 'en', value: w.en, 'aria-label': 'Englisch', 'data-key': 'edit-en' });
        const de = wordInput({ id: 'edit-de', lang: 'de', value: w.de, 'aria-label': 'Deutsch' });
        return h('li', { class: 'word-row is-editing' },
          h('form', {
            class: 'edit-form',
            onsubmit: (e) => {
              e.preventDefault();
              if (en.value.trim() && de.value.trim()) {
                w.en = en.value.trim();
                w.de = de.value.trim();
                touch(entry.list);
              }
              v.editId = null;
              rerender('edit-' + w.id);
            },
          },
          en, de,
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-primary', type: 'submit' }, 'Speichern'),
            h('button', {
              class: 'btn',
              type: 'button',
              onclick: () => {
                v.editId = null;
                rerender('edit-' + w.id);
              },
            }, 'Abbrechen'),
            h('button', {
              class: 'btn btn-danger',
              type: 'button',
              onclick: () => {
                entry.list.words = entry.list.words.filter((x) => x !== w);
                touch(entry.list);
                v.editId = null;
                rerender();
              },
            }, icon('trash'), 'Löschen')
          ))
        );
      }
      return h('li', { class: 'word-row' + (w.hard ? ' is-hard' : '') },
        hardToggle(entry, { compact: true, onChange: () => rerender('hard-' + w.id) }),
        h('span', { class: 'word-en', lang: 'en' }, h('span', { class: w.hard ? 'marker' : null }, w.en)),
        h('span', { class: 'word-de', lang: 'de' }, w.de,
          isHard && data.lists.length > 1 ? h('span', { class: 'word-list' }, entry.list.name) : null),
        h('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': '„' + w.en + '“ bearbeiten',
          'data-key': 'edit-' + w.id,
          onclick: () => {
            v.editId = w.id;
            rerender('edit-en');
          },
        }, icon('edit'))
      );
    };

    let addForm = null;
    if (list) {
      const en = wordInput({ id: 'add-en', lang: 'en', placeholder: 'Englisch', 'aria-label': 'Neue Vokabel, Englisch', 'data-key': 'add-en' });
      const de = wordInput({ id: 'add-de', lang: 'de', placeholder: 'Deutsch', 'aria-label': 'Neue Vokabel, Deutsch' });
      addForm = h('form', {
        class: 'add-form',
        onsubmit: (e) => {
          e.preventDefault();
          if (!en.value.trim() || !de.value.trim()) return;
          list.words.push({ id: Store.newId(), en: en.value.trim(), de: de.value.trim(), hard: false });
          touch(list);
          rerender('add-en');
        },
      }, en, de, h('button', { class: 'btn', type: 'submit' }, icon('plus'), 'Hinzufügen'));
    }

    const words = h('section', { class: 'panel', 'aria-labelledby': 'words-title' },
      h('h2', { id: 'words-title' }, isHard ? 'Markierte Vokabeln' : 'Vokabeln', h('span', { class: 'count' }, String(entries.length))),
      entries.length ? [
        h('div', { class: 'word-head', 'aria-hidden': 'true' }, h('span'), h('span', null, 'Englisch'), h('span', null, 'Deutsch'), h('span')),
        h('ul', { class: 'word-list-rows' }, entries.map(row)),
      ] : h('p', { class: 'muted' }, isHard
        ? 'Du hast noch keine Vokabel als schwer markiert.'
        : 'Noch keine Vokabeln in dieser Liste.'),
      addForm
    );

    // --- Liste verwalten
    let manage = null;
    if (list) {
      manage = h('section', { class: 'manage' },
        importBox(list.id),
        v.confirmDelete
          ? h('div', { class: 'confirm', role: 'group', 'aria-label': 'Liste löschen' },
            h('p', null, '„' + list.name + '“ mit ' + count(list.words.length) + ' wirklich löschen?'),
            h('div', { class: 'btn-row' },
              h('button', {
                class: 'btn btn-danger',
                type: 'button',
                'data-key': 'delete-yes',
                onclick: () => {
                  data.lists = data.lists.filter((l) => l !== list);
                  touch(null);
                  flash = { kind: 'ok', text: '„' + list.name + '“ wurde gelöscht.' };
                  go({ name: 'home' });
                },
              }, 'Ja, löschen'),
              h('button', {
                class: 'btn',
                type: 'button',
                onclick: () => {
                  v.confirmDelete = false;
                  rerender('delete');
                },
              }, 'Abbrechen')
            ))
          : h('button', {
            class: 'btn btn-quiet btn-danger-quiet',
            type: 'button',
            'data-key': 'delete',
            onclick: () => {
              v.confirmDelete = true;
              rerender('delete-yes');
            },
          }, icon('trash'), 'Liste löschen')
      );
    }

    return h('div', { class: 'view' },
      h('button', { class: 'back-link', type: 'button', onclick: () => go({ name: 'home' }) }, icon('back'), 'Alle Listen'),
      title,
      h('p', { class: 'lead' }, isHard
        ? 'Alle Vokabeln, die du mit dem Stern markiert hast, aus allen Listen.'
        : count(entries.length) + (hardCount ? ', davon ' + hardCount + ' als schwer markiert' : '')),
      practice,
      words,
      manage
    );
  }

  // ------------------------------------------------------------ Übungsrunde

  const MODE_TITLE = {
    'cards:de-en': 'Karteikarten: Deutsch → Englisch',
    'cards:en-de': 'Karteikarten: Englisch → Deutsch',
    'write:de-en': 'Schreiben: Englisch tippen',
  };

  function startSession(mode, dir, source, onlyEntries) {
    const entries = onlyEntries || entriesFor(source);
    if (!entries.length) return;
    const byId = new Map(entries.map((e) => [e.word.id, e]));
    go({
      name: 'session',
      mode,
      dir,
      source,
      byId,
      session: Trainer.createSession(Array.from(byId.keys())),
      flipped: false,
    });
  }

  function sourceView(source) {
    return { name: 'list', id: source.listId, scope: source.scope };
  }

  function finishSession(v) {
    go({
      name: 'summary',
      mode: v.mode,
      dir: v.dir,
      source: v.source,
      total: v.session.total,
      entries: Array.from(v.byId.values()),
      missed: v.session.missed.map((id) => v.byId.get(id)),
    });
  }

  function sizeClass(text) {
    const n = text.length;
    return n <= 12 ? 'size-xl' : n <= 26 ? 'size-l' : n <= 60 ? 'size-m' : 'size-s';
  }

  function sessionTop(v) {
    const s = v.session;
    const fill = h('div', { class: 'progress-fill' });
    const label = h('span', { class: 'session-count' });
    const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Fortschritt', 'aria-valuemin': '0', 'aria-valuemax': String(s.total) }, fill);
    const paint = () => {
      label.textContent = s.cleared + ' von ' + s.total + ' geschafft';
      fill.style.width = (s.total ? (100 * s.cleared) / s.total : 0) + '%';
      bar.setAttribute('aria-valuenow', String(s.cleared));
    };
    paint();
    const node = h('header', { class: 'session-top' },
      h('div', { class: 'session-bar' },
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => go(sourceView(v.source)) }, icon('close'), 'Beenden'),
        label
      ),
      h('h1', { class: 'session-title' }, MODE_TITLE[v.mode + ':' + v.dir]),
      bar
    );
    return { node, paint };
  }

  function sessionView() {
    return view.mode === 'write' ? writeView() : cardsView();
  }

  function cardsView() {
    const v = view;
    const entry = v.byId.get(Trainer.currentCard(v.session));
    const w = entry.word;
    const de = { label: 'Deutsch', text: w.de, lang: 'de' };
    const en = { label: 'Englisch', text: w.en, lang: 'en' };
    const front = v.dir === 'de-en' ? de : en;
    const back = v.dir === 'de-en' ? en : de;
    const top = sessionTop(v);

    const face = (side, which) => h('span', { class: 'face face-' + which, 'aria-hidden': String((which === 'back') !== v.flipped) },
      h('span', { class: 'face-label' }, side.label),
      h('span', { class: 'face-word ' + sizeClass(side.text), lang: side.lang }, side.text)
    );
    const frontFace = face(front, 'front');
    const backFace = face(back, 'back');
    const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });

    const answer = (ok) => {
      Trainer.answerCard(v.session, ok);
      v.flipped = false;
      if (Trainer.isFinished(v.session)) finishSession(v);
      else render();
    };
    const known = h('button', { class: 'btn btn-right', type: 'button', onclick: () => answer(true) }, icon('check'), 'Gewusst');
    const unknown = h('button', { class: 'btn btn-wrong', type: 'button', onclick: () => answer(false) }, icon('close'), 'Nicht gewusst');
    const flipBtn = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => flip() }, 'Umdrehen');
    const rate = h('div', { class: 'btn-row rate', hidden: !v.flipped }, unknown, known);
    const before = h('div', { class: 'btn-row rate rate-single', hidden: v.flipped }, flipBtn);

    const card = h('button', {
      class: 'flashcard' + (v.flipped ? ' is-flipped' : ''),
      type: 'button',
      'data-autofocus': true,
      onclick: () => flip(),
    }, h('span', { class: 'flashcard-inner' }, frontFace, backFace));

    function flip() {
      v.flipped = !v.flipped;
      card.classList.toggle('is-flipped', v.flipped);
      frontFace.setAttribute('aria-hidden', String(v.flipped));
      backFace.setAttribute('aria-hidden', String(!v.flipped));
      // Die Bewertung bleibt sichtbar, sobald die Lösung einmal zu sehen war.
      if (v.flipped) {
        rate.hidden = false;
        before.hidden = true;
        live.textContent = back.label + ': ' + back.text;
        known.focus({ preventScroll: true });
      }
    }

    const onKey = (e) => {
      if (rate.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight') answer(true);
      else if (e.key === 'ArrowLeft') answer(false);
    };
    document.addEventListener('keydown', onKey);
    leave = () => document.removeEventListener('keydown', onKey);

    return h('div', { class: 'view view-session' },
      top.node,
      card,
      live,
      h('p', { class: 'muted hint' }, 'Karte antippen zum Umdrehen. Nicht gewusste Karten kommen noch einmal.'),
      before,
      rate,
      h('div', { class: 'session-extra' }, hardToggle(entry))
    );
  }

  // Die Schreibübung baut ihre Elemente einmal und tauscht dann nur die
  // Inhalte aus. So bleibt das Eingabefeld im Fokus und die Handy-Tastatur
  // offen.
  function writeView() {
    const v = view;
    const top = sessionTop(v);
    let entry = null;
    let phase = 'ask';
    let result = null;

    const word = h('p', { class: 'prompt-word', lang: 'de' });
    const input = wordInput({
      id: 'answer',
      lang: 'en',
      enterkeyhint: 'done',
      placeholder: 'Englische Übersetzung',
      'data-autofocus': true,
    });
    // Nach dem Prüfen bleibt das Feld fokussiert, nimmt aber keine Eingabe an.
    // Die Eingabetaste (insertLineBreak) muss durchkommen, sie schickt das
    // Formular ab und führt zur nächsten Vokabel.
    input.addEventListener('beforeinput', (e) => {
      if (phase === 'result' && e.inputType !== 'insertLineBreak') e.preventDefault();
    });
    const feedback = h('div', { class: 'feedback', role: 'status', hidden: true });
    const checkBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Prüfen');
    const skipBtn = h('button', { class: 'btn', type: 'button', onclick: () => check(true) }, 'Ich weiß es nicht');
    const nextBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Weiter', icon('arrow'));
    const overrideBtn = h('button', {
      class: 'btn',
      type: 'button',
      onclick: () => {
        result = { ok: true };
        next();
      },
    }, 'Zählt als richtig');
    const askRow = h('div', { class: 'btn-row' }, checkBtn, skipBtn);
    const resultRow = h('div', { class: 'btn-row', hidden: true }, nextBtn, overrideBtn);
    const extra = h('div', { class: 'session-extra' });

    function show() {
      entry = v.byId.get(Trainer.currentCard(v.session));
      phase = 'ask';
      result = null;
      word.textContent = entry.word.de;
      word.className = 'prompt-word ' + sizeClass(entry.word.de);
      input.value = '';
      input.classList.remove('is-right', 'is-wrong');
      feedback.hidden = true;
      feedback.replaceChildren();
      askRow.hidden = false;
      resultRow.hidden = true;
      extra.replaceChildren(hardToggle(entry));
      top.paint();
      input.focus({ preventScroll: true });
    }

    function check(skipped) {
      const typed = input.value.trim();
      if (!skipped && !typed) {
        input.focus();
        return;
      }
      result = skipped ? { ok: false, close: false } : Trainer.checkAnswer(typed, entry.word.en);
      phase = 'result';
      input.classList.add(result.ok ? 'is-right' : 'is-wrong');
      feedback.className = 'feedback ' + (result.ok ? 'is-right' : 'is-wrong');
      if (result.ok) {
        fill(feedback,
          h('p', { class: 'feedback-title' }, icon('check'), 'Richtig'),
          h('p', { class: 'feedback-solution', lang: 'en' }, entry.word.en)
        );
      } else {
        fill(feedback,
          h('p', { class: 'feedback-title' }, icon('close'),
            skipped ? 'Die Lösung' : result.close ? 'Fast richtig. Achte auf die Schreibweise.' : 'Leider falsch'),
          h('p', { class: 'feedback-label' }, 'Richtig ist'),
          h('p', { class: 'feedback-solution', lang: 'en' }, entry.word.en),
          skipped ? null : [
            h('p', { class: 'feedback-label' }, 'Deine Antwort'),
            h('p', { class: 'feedback-typed', lang: 'en' }, typed),
          ]
        );
      }
      feedback.hidden = false;
      askRow.hidden = true;
      resultRow.hidden = false;
      overrideBtn.hidden = result.ok || skipped;
      input.focus({ preventScroll: true });
    }

    function next() {
      Trainer.answerCard(v.session, result.ok);
      if (Trainer.isFinished(v.session)) finishSession(v);
      else show();
    }

    const form = h('form', {
      class: 'write-form',
      onsubmit: (e) => {
        e.preventDefault();
        if (phase === 'ask') check(false);
        else next();
      },
    },
    h('label', { for: 'answer' }, 'Auf Englisch'),
    input, feedback, askRow, resultRow);

    const node = h('div', { class: 'view view-session' },
      top.node,
      h('div', { class: 'prompt-card' }, h('span', { class: 'face-label' }, 'Deutsch'), word),
      form,
      h('p', { class: 'muted hint' }, 'Groß- und Kleinschreibung zählt nicht, die Buchstaben schon. Falsche Vokabeln kommen noch einmal.'),
      extra
    );
    show();
    return node;
  }

  // -------------------------------------------------------------- Auswertung

  function summaryView() {
    const v = view;
    const firstTry = v.total - v.missed.length;
    const rerender = (key) => render({ keepScroll: true, focusKey: key });
    const unmarked = v.missed.filter((e) => !e.word.hard);

    return h('div', { class: 'view view-summary' },
      h('h1', null, v.missed.length ? 'Runde geschafft' : 'Alles gewusst'),
      h('p', { class: 'score' },
        h('span', { class: 'score-number' }, firstTry + ' von ' + v.total),
        h('span', { class: 'score-label' }, 'beim ersten Versuch richtig')
      ),
      h('p', { class: 'muted' }, MODE_TITLE[v.mode + ':' + v.dir]),

      v.missed.length ? h('section', { class: 'panel', 'aria-labelledby': 'missed-title' },
        h('h2', { id: 'missed-title' }, 'Nicht sofort gewusst', h('span', { class: 'count' }, String(v.missed.length))),
        h('ul', { class: 'word-list-rows' }, v.missed.map((entry) => h('li', { class: 'word-row' + (entry.word.hard ? ' is-hard' : '') },
          hardToggle(entry, { compact: true, onChange: () => rerender('hard-' + entry.word.id) }),
          h('span', { class: 'word-en', lang: 'en' }, h('span', { class: entry.word.hard ? 'marker' : null }, entry.word.en)),
          h('span', { class: 'word-de', lang: 'de' }, entry.word.de),
          h('span')
        ))),
        unmarked.length ? h('button', {
          class: 'btn',
          type: 'button',
          'data-key': 'mark-all',
          onclick: () => {
            const lists = new Set();
            unmarked.forEach((e) => {
              e.word.hard = true;
              lists.add(e.list);
            });
            lists.forEach((l) => {
              l.updated = Date.now();
            });
            Store.save(data);
            rerender('again');
          },
        }, icon('star', true), 'Alle als schwer markieren') : null
      ) : null,

      h('div', { class: 'btn-row' },
        v.missed.length ? h('button', {
          class: 'btn btn-primary',
          type: 'button',
          'data-autofocus': true,
          onclick: () => startSession(v.mode, v.dir, v.source, v.missed),
        }, 'Nur die Fehler üben') : null,
        h('button', {
          class: 'btn' + (v.missed.length ? '' : ' btn-primary'),
          type: 'button',
          'data-key': 'again',
          'data-autofocus': !v.missed.length,
          onclick: () => startSession(v.mode, v.dir, v.source, v.entries),
        }, 'Noch eine Runde'),
        h('button', { class: 'btn', type: 'button', onclick: () => go(sourceView(v.source)) }, 'Zurück zur Liste')
      )
    );
  }

  const VIEWS = {
    home: homeView,
    list: listView,
    loading: loadingView,
    text: textView,
    review: reviewView,
    session: sessionView,
    summary: summaryView,
  };

  // -------------------------------------------- Schnittstelle für cloud.js

  function applyMerge() {
    const merge = pendingMerge;
    pendingMerge = null;
    data.lists = merge(data.lists);
    Store.save(data);
  }

  window.VokabelApp = {
    getData: () => data,
    // merge(lists) -> lists. Läuft sofort oder, während einer Übung oder
    // eines Imports, sobald diese beendet sind.
    mergeLists(merge) {
      pendingMerge = merge;
      if (BUSY.has(view.name)) return;
      applyMerge();
      render({ keepScroll: true });
    },
    setStorageStatus(status) {
      if (status === 'local' && !Store.isAvailable()) status = 'none';
      if (status === storageStatus) return;
      storageStatus = status;
      const old = root.querySelector('.app-footer');
      if (old) old.replaceWith(footer());
    },
  };

  document.querySelector('.wordmark').addEventListener('click', (e) => {
    e.preventDefault();
    if (view.name === 'loading') return;
    go({ name: 'home' });
  });

  render();
})();
