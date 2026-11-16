/*
 * Lernlogik ohne Oberfläche: Antworten der Schreibübung prüfen und die
 * Reihenfolge der Karten in einer Übungsrunde verwalten.
 *
 * Reine Funktionen, mit `npm test` in Node prüfbar. Im Browser als
 * `VokabelTrainer` verfügbar.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VokabelTrainer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------ Antwort prüfen

  // Vereinheitlicht Schreibweisen, die nicht als Fehler zählen sollen:
  // Groß-/Kleinschreibung, Satzzeichen, Bindestriche, sth/something usw.
  function normalize(s) {
    return String(s == null ? '' : s)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[‘’ʼ`´]/g, "'")
      .replace(/["“”„«»]/g, '')
      .replace(/\bs\.\s?o\.(?=\s|$)/g, 'sb')
      .replace(/\b(?:something|smth|sth)\b\.?/g, 'sth')
      .replace(/\b(?:somebody|someone|sb)\b\.?/g, 'sb')
      .replace(/[-‐-―]/g, ' ')
      .replace(/[.!?…,;]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // "to go" und "go", "a house" und "house" gelten als gleich.
  function canon(s) {
    return normalize(s).replace(/^(?:to|a|an|the)\s+(?=\S)/, '');
  }

  // Klammern auflösen: "colo(u)r" -> color/colour, "(to) go" -> go/to go,
  // "to gather (feedback)" -> gather / gather feedback.
  function expandParens(s, depth) {
    const m = /\(([^()]*)\)/.exec(s);
    if (!m || depth > 3) return [s.replace(/[()]/g, ' ')];
    const before = s.slice(0, m.index);
    const after = s.slice(m.index + m[0].length);
    const inner = m[1].trim();
    // Beides gilt: ohne den Klammerteil und mit ihm
    // ("to adapt" und "to adapt sth to sth").
    return expandParens(before + after, depth + 1).concat(expandParens(before + inner + after, depth + 1));
  }

  // Mehrere Lösungen in einem Eintrag: "big, large", "autumn/fall".
  function alternatives(s) {
    let parts = s.split(/\s*[;,|]\s*|\s+\/\s+/);
    if (!/\s/.test(s.trim()) && s.indexOf('/') !== -1) parts = s.split('/');
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  function acceptedAnswers(solution) {
    const base = String(solution || '')
      .replace(/\[[^\]]*\]/g, ' ') // Lautschrift [haʊs]
      .replace(/(^|\s)\/[^/\s][^/]*\/(?=\s|$)/g, ' '); // Lautschrift /haʊs/
    const accepted = new Set();
    let variants = expandParens(base, 0);
    if (!variants.some((v) => canon(v))) variants = [base.replace(/[()]/g, ' ')];
    for (const v of variants) {
      const whole = canon(v);
      if (whole) accepted.add(whole);
      for (const alt of alternatives(v)) {
        const c = canon(alt);
        if (c) accepted.add(c);
      }
    }
    return accepted;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    let prev = [];
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1)
        );
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // Ergebnis: { ok, close }. close = knapp daneben (Tippfehler); zählt als
  // falsch, weil es in der Schreibübung auf die Schreibweise ankommt.
  function checkAnswer(input, solution) {
    const accepted = acceptedAnswers(solution);
    const whole = canon(input);
    if (!whole) return { ok: false, close: false };
    if (accepted.has(whole)) return { ok: true, close: false };

    // Mehrere Lösungen eingegeben ("large, big"): jede muss stimmen.
    const parts = alternatives(String(input)).map(canon).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => accepted.has(p))) return { ok: true, close: false };

    let close = false;
    accepted.forEach((a) => {
      const allowed = a.length >= 8 ? 2 : a.length >= 4 ? 1 : 0;
      if (allowed && levenshtein(whole, a) <= allowed) close = true;
    });
    return { ok: false, close };
  }

  // -------------------------------------------------------- Übungsrunde

  function shuffle(list, random) {
    const a = list.slice();
    const rnd = random || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // Eine nicht gewusste Karte kommt nach so vielen anderen Karten wieder.
  const REPEAT_AFTER = 4;

  function createSession(ids, random) {
    return {
      queue: shuffle(ids, random),
      total: ids.length,
      cleared: 0,
      missed: [], // Karten, die nicht beim ersten Versuch saßen
    };
  }

  function currentCard(session) {
    return session.queue.length ? session.queue[0] : null;
  }

  // Wertet die aktuelle Karte. Falsche Karten wandern nach hinten und
  // kommen wieder, bis sie sitzen.
  function answerCard(session, ok) {
    const id = session.queue.shift();
    if (id === undefined) return null;
    if (ok) {
      session.cleared++;
    } else {
      if (session.missed.indexOf(id) === -1) session.missed.push(id);
      session.queue.splice(Math.min(session.queue.length, REPEAT_AFTER), 0, id);
    }
    return id;
  }

  function isFinished(session) {
    return session.queue.length === 0;
  }

  return {
    normalize,
    acceptedAnswers,
    checkAnswer,
    levenshtein,
    shuffle,
    createSession,
    currentCard,
    answerCard,
    isFinished,
  };
});
