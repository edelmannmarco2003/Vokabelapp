'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Parser = require('../js/parser.js');

// Die Fixtures sind die Textstücke, die pdf.js aus echten Test-PDFs liest.
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name + '.json'), 'utf8'));
const pairsOf = (result) => Parser.toPairs(result.rows, result.en, result.de);

// Kleine Hilfe, um eine Seite von Hand zu beschreiben: [x, y, text, font?]
const page = (items) => items.map(([x, y, str, font]) => ({ str, x, y, w: str.length * 5.5, h: 11, font: font || 'f1' }));

test('Tabelle mit drei Spalten: Kopfzeile weg, Umbrüche zusammengefügt', () => {
  const r = Parser.parsePages(fixture('tabelle-3-spalten'));
  assert.equal(r.mode, 'table');
  assert.equal(r.columnCount, 3);
  assert.equal(r.en, 0);
  assert.equal(r.de, 1);
  const pairs = pairsOf(r);
  assert.equal(pairs.length, 14);
  assert.deepEqual(pairs[0], { en: 'house', de: 'das Haus' });
  assert.deepEqual(pairs[6], {
    en: 'to be able to do something even though it is difficult',
    de: 'etwas tun können, obwohl es schwierig ist',
  });
  // Der umbrochene Beispielsatz bleibt in seiner eigenen Spalte.
  assert.equal(r.rows[8][2], 'We must protect the environment and all the animals that live in it.');
});

test('Deutsch steht links: Sprachen werden erkannt', () => {
  for (const name of ['liste-deutsch-zuerst', 'html-tabelle-deutsch-zuerst']) {
    const r = Parser.parsePages(fixture(name));
    assert.equal(r.de, 0, name);
    assert.equal(r.en, 1, name);
    assert.equal(r.confident, true, name);
  }
  const pairs = pairsOf(Parser.parsePages(fixture('liste-deutsch-zuerst')));
  assert.equal(pairs.length, 20); // fette Zwischenüberschriften "Unit 2" fallen weg
  assert.deepEqual(pairs[0], { en: 'house', de: 'das Haus' });
});

test('vertikal zentrierte Zellen mit Umbruch ergeben eine Zeile', () => {
  const pairs = pairsOf(Parser.parsePages(fixture('tabelle-zentriert-umbruch')));
  assert.equal(pairs.length, 12);
  assert.deepEqual(pairs[3], { en: 'to look forward to something', de: 'sich auf etwas freuen' });
  assert.deepEqual(pairs[5], { en: 'neighbour', de: 'der Nachbar, die Nachbarin' });
});

test('zwei Tabellen nebeneinander werden untereinander gehängt', () => {
  const r = Parser.parsePages(fixture('zwei-tabellen-nebeneinander'));
  assert.equal(r.columnCount, 2);
  const pairs = pairsOf(r);
  assert.equal(pairs.length, 24);
  assert.deepEqual(pairs[0], { en: 'house', de: 'das Haus' });
  assert.deepEqual(pairs[12], { en: 'to improve', de: 'verbessern' });
});

test('nummerierte Liste mit Gedankenstrich', () => {
  const r = Parser.parsePages(fixture('liste-gedankenstrich'));
  assert.equal(r.mode, 'separator');
  const pairs = pairsOf(r);
  assert.equal(pairs.length, 20); // Überschrift und Seitenzahl fallen weg
  assert.deepEqual(pairs[0], { en: 'house', de: 'das Haus' });
  assert.deepEqual(pairs[5], { en: 'neighbour', de: 'der Nachbar, die Nachbarin' });
});

test('Fortsetzungszeile ohne erste Spalte gehört zur Zeile darüber', () => {
  const r = Parser.parsePages([page([
    [50, 100, 'to rely on'], [250, 100, 'sich verlassen'],
    [250, 114, 'auf jemanden'],
    [50, 128, 'tree'], [250, 128, 'der Baum'],
    [50, 142, 'cloud'], [250, 142, 'die Wolke'],
  ])]);
  assert.deepEqual(pairsOf(r), [
    { en: 'to rely on', de: 'sich verlassen auf jemanden' },
    { en: 'tree', de: 'der Baum' },
    { en: 'cloud', de: 'die Wolke' },
  ]);
});

test('Trennstrich am Zeilenende wird ohne Leerzeichen fortgesetzt', () => {
  const r = Parser.parsePages([page([
    [50, 100, 'hospital'], [250, 100, 'das Kranken-'],
    [250, 114, 'haus'],
    [50, 128, 'tree'], [250, 128, 'der Baum'],
    [50, 142, 'cloud'], [250, 142, 'die Wolke'],
  ])]);
  assert.equal(pairsOf(r)[0].de, 'das Kranken-haus');
});

test('Nummernspalte wird entfernt', () => {
  const r = Parser.parsePages([page([
    [30, 100, '1'], [60, 100, 'house'], [250, 100, 'das Haus'],
    [30, 114, '2'], [60, 114, 'to go'], [250, 114, 'gehen'],
    [30, 128, '3'], [60, 128, 'tree'], [250, 128, 'der Baum'],
  ])]);
  assert.equal(r.columnCount, 2);
  assert.deepEqual(pairsOf(r)[1], { en: 'to go', de: 'gehen' });
});

test('ohne Text gibt es keine Zeilen', () => {
  const r = Parser.parsePages([[]]);
  assert.equal(r.mode, 'none');
  assert.deepEqual(r.rows, []);
  assert.equal(r.rawText, '');
});

test('Fließtext ohne Vokabelpaare wird nicht als Tabelle gedeutet', () => {
  const r = Parser.parsePages([page([
    [50, 100, 'Dies ist ein ganz normaler Absatz ohne Vokabeln.'],
    [50, 114, 'Er hat mehrere Zeilen und keinen Trenner.'],
    [50, 128, 'Deshalb darf nichts erkannt werden.'],
  ])]);
  assert.deepEqual(pairsOf(r), []);
  assert.match(r.rawText, /normaler Absatz/);
});

test('eingefügter Text: verschiedene Trennzeichen', () => {
  const cases = {
    'house – das Haus\ntree – der Baum': 'dash',
    'house - das Haus\ntree - der Baum': 'hyphen',
    'house = das Haus\ntree = der Baum': 'equals',
    'house\tdas Haus\ntree\tder Baum': 'tab',
    'house; das Haus\ntree; der Baum': 'semicolon',
    'house: das Haus\ntree: der Baum': 'colon',
    'house, das Haus\ntree, der Baum': 'comma',
    'house    das Haus\ntree    der Baum': 'spaces',
  };
  for (const text of Object.keys(cases)) {
    assert.deepEqual(pairsOf(Parser.parseText(text)), [
      { en: 'house', de: 'das Haus' },
      { en: 'tree', de: 'der Baum' },
    ], cases[text]);
  }
});

test('eingefügter Text: Nummern und Aufzählungszeichen fallen weg', () => {
  const r = Parser.parseText('1. well-known = bekannt\n2) to go = gehen\n• tree = der Baum\n\nÜberschrift');
  assert.deepEqual(pairsOf(r), [
    { en: 'well-known', de: 'bekannt' },
    { en: 'to go', de: 'gehen' },
    { en: 'tree', de: 'der Baum' },
  ]);
});

test('eingefügter Text: Deutsch zuerst wird erkannt', () => {
  const r = Parser.parseText('das Haus – house\ngehen – to go\ndie Umwelt – the environment');
  assert.deepEqual(pairsOf(r)[0], { en: 'house', de: 'das Haus' });
});

test('Kopfzeile bestimmt die Sprachen, auch gegen den Anschein', () => {
  const r = Parser.parseText('Deutsch\tEnglisch\nHand\thand\nWind\twind');
  assert.equal(r.de, 0);
  assert.equal(r.en, 1);
  assert.equal(r.rows.length, 2);
});

test('Vokabeln, die wie Spaltentitel aussehen, bleiben erhalten', () => {
  const r = Parser.parseText('house = das Haus\nexample = Beispiel\nGerman = Deutsch\nEnglish = Englisch\nword = Wort');
  assert.equal(r.rows.length, 5);
  assert.deepEqual(pairsOf(r)[2], { en: 'German', de: 'Deutsch' });
});

test('Titelzeile ohne Sprachnamen am Seitenanfang fällt weg', () => {
  const r = Parser.parseText('Vokabel\tÜbersetzung\nhouse\tdas Haus\ntree\tder Baum');
  assert.deepEqual(pairsOf(r), [
    { en: 'house', de: 'das Haus' },
    { en: 'tree', de: 'der Baum' },
  ]);
});

test('wiederholte Kopfzeile mit "Example / note" fällt auf jeder Seite weg', () => {
  const r = Parser.parseText([
    'English\tDeutsch\tExample / note',
    'blocker\tHindernis\tAny blockers?',
    'English\tDeutsch\tExample / note',
    'token\tToken\tlogin tokens expire',
  ].join('\n'));
  assert.deepEqual(pairsOf(r), [
    { en: 'blocker', de: 'Hindernis' },
    { en: 'token', de: 'Token' },
  ]);
});

test('scoreLang unterscheidet Deutsch und Englisch', () => {
  assert.ok(Parser.scoreLang('die Umweltverschmutzung') > 0);
  assert.ok(Parser.scoreLang('sich auf etwas freuen') > 0);
  assert.ok(Parser.scoreLang('to look forward to something') < 0);
  assert.ok(Parser.scoreLang('although') < 0);
});
