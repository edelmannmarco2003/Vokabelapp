// Erzeugt die Dateien in vendor/ aus den npm-Paketen (nur nötig, wenn
// pdf.js oder die Schriften aktualisiert werden sollen):
//
//   npm install && npm run build:vendor
//
// pdf.js wird zusammen mit seinem "Worker" in EINE klassische Skriptdatei
// gebündelt. Dadurch läuft die App auch dann, wenn index.html einfach per
// Doppelklick geöffnet wird (dort sind ES-Module und Web Worker gesperrt).
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = (...p) => path.join(root, 'vendor', ...p);

await mkdir(out('pdfjs'), { recursive: true });
await mkdir(out('fonts'), { recursive: true });

const pdfVersion = JSON.parse(await readFile(nm('pdfjs-dist', 'package.json'), 'utf8')).version;

await build({
  stdin: {
    contents: `
      import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
      import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
      // Ist pdfjsWorker gesetzt, rechnet pdf.js im Hauptthread und braucht
      // keine separate Worker-Datei.
      globalThis.pdfjsWorker = { WorkerMessageHandler };
      globalThis.pdfjsLib = pdfjsLib;
    `,
    resolveDir: root,
    loader: 'js',
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2019'],
  minify: true,
  legalComments: 'none',
  banner: { js: `/* pdf.js ${pdfVersion} (Mozilla, Apache-2.0) - erzeugt von tools/build-vendor.mjs */` },
  outfile: out('pdfjs', 'pdf.bundle.js'),
  logLevel: 'warning',
  // import.meta.url wird nur in Node-/WASM-Zweigen benutzt, die im Browser
  // für das Auslesen von Text nie erreicht werden.
  logOverride: { 'empty-import-meta': 'silent' },
});
await copyFile(nm('pdfjs-dist', 'LICENSE'), out('pdfjs', 'LICENSE'));

const fonts = [
  ['@fontsource/atkinson-hyperlegible', 'atkinson-hyperlegible-latin-400-normal.woff2'],
  ['@fontsource/atkinson-hyperlegible', 'atkinson-hyperlegible-latin-700-normal.woff2'],
  ['@fontsource-variable/bricolage-grotesque', 'bricolage-grotesque-latin-wght-normal.woff2'],
];
let licenses = '';
for (const [pkg, file] of fonts) {
  await copyFile(nm(pkg, 'files', file), out('fonts', file));
}
for (const pkg of new Set(fonts.map((f) => f[0]))) {
  licenses += `===== ${pkg} =====\n\n${await readFile(nm(pkg, 'LICENSE'), 'utf8')}\n\n`;
}
await writeFile(out('fonts', 'LICENSE.txt'), licenses);

console.log(`vendor/ aktualisiert (pdf.js ${pdfVersion})`);
