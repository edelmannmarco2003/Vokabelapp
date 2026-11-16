'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/trainer.js');

const ok = (input, solution) => T.checkAnswer(input, solution).ok;

test('exakte Antwort, Groß-/Kleinschreibung und Leerzeichen', () => {
  assert.equal(ok('house', 'house'), true);
  assert.equal(ok('  House ', 'house'), true);
  assert.equal(ok('hause', 'house'), false);
  assert.equal(ok('', 'house'), false);
});

test('Tippfehler zählen als falsch, werden aber als knapp erkannt', () => {
  assert.deepEqual(T.checkAnswer('enviroment', 'environment'), { ok: false, close: true });
  assert.deepEqual(T.checkAnswer('hous', 'house'), { ok: false, close: true });
  assert.deepEqual(T.checkAnswer('tree', 'house'), { ok: false, close: false });
  assert.deepEqual(T.checkAnswer('cut', 'cat'), { ok: false, close: false }); // kurze Wörter: kein "fast"
});

test('"to" und Artikel am Anfang sind freiwillig', () => {
  assert.equal(ok('go', 'to go'), true);
  assert.equal(ok('to go', 'go'), true);
  assert.equal(ok('house', 'a house'), true);
  assert.equal(ok('the house', 'house'), true);
  assert.equal(ok('to', 'to go'), false);
});

test('mehrere Lösungen in einem Eintrag', () => {
  assert.equal(ok('big', 'big, large'), true);
  assert.equal(ok('large', 'big, large'), true);
  assert.equal(ok('large, big', 'big, large'), true);
  assert.equal(ok('big, small', 'big, large'), false);
  assert.equal(ok('fall', 'autumn/fall'), true);
  assert.equal(ok('autumn', 'autumn / fall'), true);
  assert.equal(ok('at', 'to look at sb/sth'), false);
});

test('Klammern: freiwillige Teile und Anmerkungen', () => {
  assert.equal(ok('color', 'colo(u)r'), true);
  assert.equal(ok('colour', 'colo(u)r'), true);
  assert.equal(ok('go', '(to) go'), true);
  assert.equal(ok('child', 'child (pl. children)'), true);
  assert.equal(ok('children', 'child (pl. children)'), false);
  assert.equal(ok('flat', 'flat (BE)'), true);
  assert.equal(ok('to adapt sth to sth', 'to adapt (sth to sth)'), true);
  assert.equal(ok('adapt', 'to adapt (sth to sth)'), true);
  assert.equal(ok('gather feedback', 'to gather (feedback)'), true);
  assert.equal(ok('feedback', 'to gather (feedback)'), false);
});

test('Lautschrift gehört nicht zur Antwort', () => {
  assert.equal(ok('house', 'house [haʊs]'), true);
  assert.equal(ok('house', 'house /haʊs/'), true);
});

test('sth/sb, Bindestriche und Apostrophe', () => {
  assert.equal(ok('to look forward to something', 'to look forward to sth'), true);
  assert.equal(ok('look forward to sth.', 'to look forward to something'), true);
  assert.equal(ok('to ask someone', 'to ask sb'), true);
  assert.equal(ok('well known', 'well-known'), true);
  assert.equal(ok('don’t', "don't"), true);
});

test('Übungsrunde: falsche Karten kommen wieder, bis sie sitzen', () => {
  const s = T.createSession(['a', 'b', 'c'], () => 0.999); // Reihenfolge bleibt
  assert.deepEqual(s.queue, ['a', 'b', 'c']);
  assert.equal(T.currentCard(s), 'a');
  T.answerCard(s, false);
  assert.deepEqual(s.queue, ['b', 'c', 'a']);
  T.answerCard(s, true);
  T.answerCard(s, true);
  assert.equal(T.isFinished(s), false);
  assert.equal(T.currentCard(s), 'a');
  T.answerCard(s, false);
  assert.deepEqual(s.missed, ['a']); // nur einmal gezählt
  T.answerCard(s, true);
  assert.equal(T.isFinished(s), true);
  assert.equal(s.cleared, 3);
  assert.equal(T.answerCard(s, true), null);
});

test('Übungsrunde: falsche Karte kommt nach vier anderen wieder', () => {
  const s = T.createSession(['a', 'b', 'c', 'd', 'e', 'f', 'g'], () => 0.999);
  T.answerCard(s, false);
  assert.deepEqual(s.queue, ['b', 'c', 'd', 'e', 'a', 'f', 'g']);
});

test('shuffle behält alle Elemente und ändert die Vorlage nicht', () => {
  const src = [1, 2, 3, 4, 5, 6];
  const out = T.shuffle(src);
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(out.slice().sort(), src);
});
