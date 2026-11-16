# Vokabeltrainer

Englisch-Vokabeln aus einer PDF lernen: PDF hochladen, die erkannten Vokabeln kurz prüfen und dann üben.

Eingebaut ist die Liste „Working in an Agile Team: Daily Stand-up Meetings“ (74 Vokabeln). Weitere eingebaute Listen kommen in `js/builtin-lists.js`.

- **Karteikarten** in beide Richtungen: Deutsch → Englisch und Englisch → Deutsch
- **Schreibübung**: Das deutsche Wort wird gezeigt, das englische muss getippt werden
- **Schwere Vokabeln**: mit dem Stern markieren und gesondert üben, pro Liste oder aus allen Listen zusammen
- Vokabeln, die nicht sitzen, kommen in derselben Runde noch einmal

Die App läuft komplett im Browser. Die PDF wird auf dem eigenen Gerät ausgelesen und nirgendwohin hochgeladen. Die Listen liegen im Speicher des Browsers (localStorage), also pro Gerät und Browser getrennt.

## Starten

Es ist keine Installation nötig.

- **Am Computer:** Repository herunterladen und `index.html` per Doppelklick öffnen.
- **Auch am Handy:** über GitHub Pages veröffentlichen. Im Repository unter *Settings → Pages* als Quelle den Branch und den Ordner `/ (root)` wählen. Kurz darauf ist die App unter `https://<benutzername>.github.io/<repository>/` erreichbar.

## Welche PDFs funktionieren

Die PDF muss echten Text enthalten (Text lässt sich im PDF-Programm markieren). Erkannt werden:

- Tabellen mit zwei oder mehr Spalten, auch mit Kopfzeile, Nummernspalte, Beispielsätzen und umbrochenen Zellen
- Listen mit Trennzeichen: `house – das Haus`, `house = das Haus`, `house: das Haus`, `house; das Haus` oder mit Tabulator
- zwei Vokabeltabellen nebeneinander auf einer Seite
- beide Reihenfolgen: Englisch links oder Deutsch links

Nach dem Hochladen zeigt die App alle erkannten Paare. Dort lassen sich Zeilen ändern, löschen und die Sprachen tauschen, bevor gespeichert wird.

**Eingescannte PDFs und Fotos** enthalten keinen Text und können nicht ausgelesen werden. In dem Fall lassen sich die Vokabeln eintippen oder aus einem anderen Programm einfügen (eine Vokabel pro Zeile).

## Schreibübung: Was zählt als richtig

Es kommt auf die Buchstaben an, nicht auf Kleinigkeiten drumherum:

- Groß-/Kleinschreibung, Satzzeichen und Bindestriche zählen nicht
- `to` und Artikel am Anfang sind freiwillig (`go` = `to go`)
- bei mehreren Lösungen reicht eine (`big, large`, `autumn/fall`)
- Klammern sind freiwillig (`colo(u)r`, `child (pl. children)`), Lautschrift wird ignoriert
- `sth`/`something` und `sb`/`somebody`/`someone` sind gleichwertig

Ein Tippfehler zählt als falsch. Mit „Zählt als richtig“ lässt sich das Ergebnis von Hand korrigieren.

## Entwicklung

```
npm install
npm test               # Tests für PDF-Erkennung und Antwortprüfung
npm start              # lokaler Server auf http://localhost:8080
npm run build:vendor   # vendor/ neu erzeugen (nur nach einem Update von pdf.js oder den Schriften)
```

| Datei | Aufgabe |
| --- | --- |
| `index.html`, `css/styles.css` | Seite und Gestaltung |
| `js/parser.js` | macht aus PDF-Text oder eingefügtem Text Vokabelpaare |
| `js/pdf-extract.js` | liest den Text der PDF mit pdf.js |
| `js/trainer.js` | prüft Antworten, verwaltet die Übungsrunde |
| `js/store.js` | speichert die Listen im Browser |
| `js/builtin-lists.js` | fest eingebaute Vokabellisten |
| `js/app.js` | Oberfläche |
| `js/cloud.js` | zusätzliche Sicherung, wenn die App als Claude-Artefakt läuft; sonst ohne Wirkung |
| `vendor/` | pdf.js (Apache-2.0) und die Schriften Atkinson Hyperlegible und Bricolage Grotesque (OFL), Lizenzen liegen bei |

Es gibt keinen Build-Schritt: Die Dateien werden so ausgeliefert, wie sie im Repository liegen.
