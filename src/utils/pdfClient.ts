import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import type { PageText, PdfIndex } from '../types';
import { extractLinesFromTextItems, parseQuestionsFromPages, type RawTextItem } from './pdfParser';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const DB_NAME = 'paneldesk_private_pdf_store';
const STORE_NAME = 'active_pdf';
const RECORD_KEY = 'current';

interface StoredPdfRecord {
  index: PdfIndex;
  buffer: ArrayBuffer;
}

function openPrivateDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open local PDF cache'));
  });
}

export async function savePrivatePdfCache(index: PdfIndex, buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openPrivateDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ index, buffer }, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-fatal: app continues working purely in memory if storage quota or privacy mode blocks IndexedDB.
  }
}

export async function loadPrivatePdfCache(): Promise<StoredPdfRecord | null> {
  try {
    const db = await openPrivateDb();
    const record = await new Promise<StoredPdfRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(RECORD_KEY);
      req.onsuccess = () => resolve((req.result as StoredPdfRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return record;
  } catch {
    return null;
  }
}

export async function clearPrivatePdfCache(): Promise<void> {
  try {
    const db = await openPrivateDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore storage cleanup errors
  }
}

export async function loadPdfDocumentFromBuffer(buffer: ArrayBuffer): Promise<PDFDocumentProxy> {
  // Clone bytes because pdf.js may transfer/detach the underlying ArrayBuffer to the worker
  const copy = new Uint8Array(buffer.slice(0));
  const loadingTask = pdfjsLib.getDocument({ data: copy });
  return loadingTask.promise;
}

export async function parseAndIndexPdfFile(
  file: File,
  onProgress?: (currentPage: number, totalPages: number) => void
): Promise<{ index: PdfIndex; pdfDoc: PDFDocumentProxy; buffer: ArrayBuffer }> {
  const buffer = await file.arrayBuffer();
  const pdfDoc = await loadPdfDocumentFromBuffer(buffer);
  const totalPages = pdfDoc.numPages;

  const pages: PageText[] = [];

  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
    const page = await pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const rawItems: RawTextItem[] = [];

    for (const item of textContent.items) {
      if ('str' in item && typeof item.str === 'string') {
        const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
        rawItems.push({
          str: item.str,
          x: Number(transform[4]) || 0,
          y: Number(transform[5]) || 0,
          width: typeof item.width === 'number' ? item.width : 0,
          height: typeof item.height === 'number' ? item.height : 0,
          hasEOL: 'hasEOL' in item ? Boolean(item.hasEOL) : false,
        });
      }
    }

    const lines = extractLinesFromTextItems(rawItems);
    pages.push({
      pageNumber,
      lines,
      text: lines.join('\n'),
    });

    if (onProgress && (pageNumber === 1 || pageNumber === totalPages || pageNumber % 3 === 0)) {
      onProgress(pageNumber, totalPages);
      // Yield briefly to keep UI progress bar responsive on large 200+ page PDFs
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const questions = parseQuestionsFromPages(pages);

  const index: PdfIndex = {
    fileName: file.name,
    fileSize: file.size,
    pageCount: totalPages,
    indexedAt: Date.now(),
    questions,
    pages,
  };

  return { index, pdfDoc, buffer };
}
