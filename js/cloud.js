/*
 * Optionale Sicherung im Claude-Konto.
 *
 * Läuft die App als Claude-Artefakt, stellt die Seite dort einen kleinen
 * Datenspeicher bereit (window.claude). Dann werden die Listen zusätzlich
 * im privaten Bereich des angemeldeten Nutzers abgelegt und sind auf allen
 * Geräten verfügbar. Überall sonst (GitHub Pages, lokale Datei) passiert
 * hier nichts und es bleibt beim Speichern im Browser.
 *
 * Ablage: ein Dokument pro Liste ("list-<id>") plus "meta" mit der
 * Reihenfolge der Listen.
 */
(function () {
  'use strict';

  if (!window.claude || typeof window.claude.use !== 'function') return;

  const Store = window.VokabelStore;
  const App = window.VokabelApp;
  const SYNCED_KEY = 'vokabelapp.synced';

  let col = null; // Sammlung data/users/<id>
  let merged = false; // erst nach dem Abgleich darf geschrieben werden
  let stopped = false;
  let running = false;
  let again = false;
  let timer = null;
  const inCloud = new Map(); // Listen-ID -> Stand (updated), der in der Cloud liegt
  let metaInCloud = null;

  function knownIds() {
    try {
      return new Set(JSON.parse(window.localStorage.getItem(SYNCED_KEY) || '[]'));
    } catch (err) {
      return new Set();
    }
  }

  function rememberIds() {
    try {
      window.localStorage.setItem(SYNCED_KEY, JSON.stringify(Array.from(inCloud.keys())));
    } catch (err) {
      /* ohne localStorage geht es auch */
    }
  }

  async function connect() {
    const user = await window.claude.use('user');
    const db = await window.claude.use('db');
    const uid = user && db ? await user.id() : null;
    if (!uid) {
      App.setStorageStatus('local'); // nicht angemeldet oder Speicher nicht freigegeben
      return;
    }
    col = db.collection('data/users/' + uid);

    const snap = await col.get();
    const remote = new Map();
    let meta = null;
    snap.docs.forEach((doc) => {
      const body = doc.data();
      if (!body) return;
      if (doc.id === 'meta') {
        meta = body;
      } else if (doc.id.indexOf('list-') === 0) {
        const list = Store.sanitizeList(body);
        if (list) remote.set(list.id, list);
      }
    });
    remote.forEach((list, id) => inCloud.set(id, list.updated));
    if (meta && Array.isArray(meta.order)) metaInCloud = meta.order.join(',');

    const known = knownIds();
    App.mergeLists((local) => {
      merged = true;
      if (!meta && remote.size === 0) return local; // erste Benutzung: alles hochladen
      const localById = new Map(local.map((l) => [l.id, l]));
      const order = (meta && Array.isArray(meta.order) ? meta.order : []).filter((id) => remote.has(id));
      remote.forEach((list, id) => {
        if (order.indexOf(id) === -1) order.push(id);
      });
      const result = order.map((id) => {
        const mine = localById.get(id);
        const theirs = remote.get(id);
        return mine && mine.updated >= theirs.updated ? mine : theirs;
      });
      // Listen, die es nur hier gibt: neu angelegt, solange die Cloud nicht
      // erreichbar war. Früher gesicherte Listen wurden woanders gelöscht.
      const fresh = local.filter((l) => !remote.has(l.id) && !known.has(l.id) && l.id !== 'beispiel');
      return fresh.concat(result);
    });
    schedule(0);
  }

  function schedule(delay) {
    if (stopped || !col) return;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  }

  // Schreibt nacheinander alles, was sich seit dem letzten Stand geändert
  // hat. Nie zwei Schreibvorgänge gleichzeitig.
  async function flush() {
    if (stopped || !col || !merged) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const lists = App.getData().lists;
      const ids = new Set(lists.map((l) => l.id));
      for (const list of lists) {
        if (inCloud.get(list.id) === list.updated) continue;
        const stamp = list.updated;
        await col.doc('list-' + list.id).set({
          id: list.id,
          name: list.name,
          created: list.created,
          updated: stamp,
          words: list.words.map((w) => ({ id: w.id, en: w.en, de: w.de, hard: w.hard === true })),
        });
        inCloud.set(list.id, stamp);
      }
      for (const id of Array.from(inCloud.keys())) {
        if (ids.has(id)) continue;
        await col.doc('list-' + id).delete();
        inCloud.delete(id);
      }
      const order = lists.map((l) => l.id).join(',');
      if (order !== metaInCloud) {
        await col.doc('meta').set({ order: lists.map((l) => l.id), updated: Date.now() });
        metaInCloud = order;
      }
      rememberIds();
      App.setStorageStatus('cloud');
    } catch (err) {
      // Kein Schreibrecht, Speicher voll oder Zugriff entzogen: bei der
      // Speicherung im Browser bleiben. Vorübergehende Fehler holt der
      // nächste Speichervorgang nach.
      if (!err || err.code !== 'unavailable') stopped = true;
      App.setStorageStatus('local');
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        schedule(500);
      }
    }
  }

  Store.onSave(() => schedule(1500));
  App.setStorageStatus('pending');
  connect().catch(() => {
    App.setStorageStatus('local');
  });
})();
