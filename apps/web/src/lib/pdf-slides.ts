import { slidePicture, MAX_SLIDE_WIDTH, type SlidePicture } from './images.js';

/**
 * Slides from a PDF (PLAN.md 3.2; stage 4, W3; ADR-019, addendum): the teacher's own browser draws
 * each page and makes it a WebP within the slide budget (CLAUDE.md §3.1). pdf.js is a separate chunk
 * loaded only here, so neither the first page of the site nor a child's computer ever loads it, and
 * the server needs no native libraries to render PDF.
 */

/** A presentation exported to PDF is a few MB; a scanned textbook is not a lesson. */
export const MAX_PDF_BYTES = 40 * 1024 * 1024;
export const MAX_PDF_PAGES = 60;

export class PdfProblem extends Error {
  constructor(readonly code: 'too_large' | 'too_many_pages' | 'unreadable') {
    super(code);
  }
}

export async function pdfToPictures(
  file: Blob,
  onPage: (done: number, total: number) => void,
): Promise<SlidePicture[]> {
  if (file.size > MAX_PDF_BYTES) throw new PdfProblem('too_large');
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch {
    throw new PdfProblem('unreadable');
  }
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new PdfProblem('too_many_pages');
    const pictures: SlidePicture[] = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: MAX_SLIDE_WIDTH / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new PdfProblem('unreadable');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      pictures.push(await slidePicture(canvas));
      page.cleanup();
      onPage(n, pdf.numPages);
    }
    return pictures;
  } finally {
    void pdf.destroy();
  }
}
