/*
 * Liest den Text einer PDF-Datei mit pdf.js aus – komplett im Browser,
 * die Datei verlässt das Gerät nicht.
 *
 * pdf.js (ca. 1,8 MB) wird erst geladen, wenn die erste PDF gewählt wird.
 */
(function () {
  'use strict';

  // Dieselbe pdf.js-Version wie in vendor/ (siehe package.json). Wird nur
  // benutzt, wenn die lokale Datei fehlt oder die Seite mit
  // <html data-pdfjs="cdn"> ausgeliefert wird (Claude-Artefakt).
  const CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/';

  let loading = null;

  function loadBundle() {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdfjs/pdf.bundle.js';
      s.onload = () => (window.pdfjsLib ? resolve(window.pdfjsLib) : reject(new Error('pdfjs-missing')));
      s.onerror = () => reject(new Error('pdfjs-load'));
      document.head.appendChild(s);
    });
  }

  function loadFromCdn() {
    return Promise.all([import(CDN + 'pdf.min.mjs'), import(CDN + 'pdf.worker.min.mjs')]).then((mods) => {
      // Wie im Bündel: pdf.js rechnet im Hauptthread, ohne eigenen Worker.
      globalThis.pdfjsWorker = mods[1];
      window.pdfjsLib = mods[0];
      return mods[0];
    });
  }

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!loading) {
      const preferCdn = document.documentElement.getAttribute('data-pdfjs') === 'cdn';
      loading = (preferCdn ? loadFromCdn() : loadBundle().catch(loadFromCdn)).catch(() => {
        loading = null;
        throw new Error('pdfjs-load');
      });
    }
    return loading;
  }

  // Liefert pro Seite die Textstücke { str, x, y, w, h, font } für den Parser.
  async function extractPages(file, onProgress) {
    const pdfjsLib = await loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const task = pdfjsLib.getDocument({
      data,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });
    let doc;
    try {
      doc = await task.promise;
    } catch (err) {
      const e = new Error(err && err.name === 'PasswordException' ? 'pdf-password' : 'pdf-invalid');
      e.cause = err;
      throw e;
    }

    const pages = [];
    try {
      for (let p = 1; p <= doc.numPages; p++) {
        if (onProgress) onProgress(p, doc.numPages);
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = [];
        for (const it of content.items) {
          if (typeof it.str !== 'string' || !it.transform) continue;
          // In Bildschirm-Koordinaten umrechnen (berücksichtigt gedrehte Seiten).
          const t = pdfjsLib.Util.transform(viewport.transform, it.transform);
          items.push({
            str: it.str,
            x: t[4],
            y: t[5],
            w: it.width,
            h: Math.hypot(t[2], t[3]) || it.height || 10,
            font: it.fontName || '',
          });
        }
        pages.push(items);
        page.cleanup();
      }
    } finally {
      task.destroy();
    }
    return pages;
  }

  window.VokabelPdf = { extractPages };
})();
