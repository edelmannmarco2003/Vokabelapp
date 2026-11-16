/*
 * Speichert die Vokabellisten im Browser (localStorage).
 *
 * Datenmodell:
 *   { version: 1, seeded: true,
 *     builtins: [ IDs der eingebauten Listen, die schon angelegt wurden ],
 *     lists: [ { id, name, created, updated,
 *                words: [ { id, en, de, hard } ] } ] }
 */
(function () {
  'use strict';

  const KEY = 'vokabelapp.v1';
  let available = true;
  const listeners = [];

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Kennungen stehen später in Speicherpfaden: nur einfache Zeichen zulassen.
  function safeId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : newId();
  }

  // Lässt nur Daten in der erwarteten Form durch (z. B. nach einem
  // beschädigten Speicherstand oder Daten aus der Cloud).
  function sanitizeList(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.words)) return null;
    const words = [];
    for (const w of raw.words) {
      if (!w || typeof w.en !== 'string' || typeof w.de !== 'string') continue;
      words.push({
        id: safeId(w.id),
        en: w.en,
        de: w.de,
        hard: w.hard === true,
      });
    }
    return {
      id: safeId(raw.id),
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Liste',
      created: Number(raw.created) || Date.now(),
      updated: typeof raw.updated === 'number' && isFinite(raw.updated) ? raw.updated : Date.now(),
      words,
    };
  }

  function load() {
    try {
      const text = window.localStorage.getItem(KEY);
      if (!text) return null;
      const raw = JSON.parse(text);
      if (!raw || !Array.isArray(raw.lists)) return null;
      return {
        version: 1,
        seeded: raw.seeded === true,
        builtins: Array.isArray(raw.builtins) ? raw.builtins.filter((id) => typeof id === 'string') : [],
        lists: raw.lists.map(sanitizeList).filter(Boolean),
      };
    } catch (err) {
      available = false;
      return null;
    }
  }

  function save(data) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(data));
      available = true;
    } catch (err) {
      available = false;
    }
    listeners.forEach((fn) => fn(data));
  }

  window.VokabelStore = {
    load,
    save,
    newId,
    sanitizeList,
    isAvailable: () => available,
    // Wird nach jedem Speichern aufgerufen (für die Cloud-Sicherung).
    onSave: (fn) => listeners.push(fn),
  };
})();
