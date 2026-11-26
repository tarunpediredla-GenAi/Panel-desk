import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/types/src/display/api';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Citation } from '../types';
import { formatPageRange } from '../utils/searchIndex';

interface PdfViewerDrawerProps {
  isOpen: boolean;
  pdfDoc: PDFDocumentProxy | null;
  totalPages: number;
  citation: Citation | null;
  currentPage: number;
  onChangePage: (page: number) => void;
  onClose: () => void;
}

export function PdfViewerDrawer({
  isOpen,
  pdfDoc,
  totalPages,
  citation,
  currentPage,
  onChangePage,
  onClose,
}: PdfViewerDrawerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [zoomMultiplier, setZoomMultiplier] = useState(1.0);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showPassage, setShowPassage] = useState(true);

  // Allow Escape key to close the viewer cleanly
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Expand original passage whenever a new citation is opened
  useEffect(() => {
    if (citation) {
      setShowPassage(true);
    }
  }, [citation]);

  // Render exact PDF page to canvas using pdf.js fitted cleanly to the container width
  useEffect(() => {
    if (!isOpen || !pdfDoc || currentPage < 1 || currentPage > totalPages) return;

    let cancelled = false;

    const renderPage = async () => {
      setIsRendering(true);
      setRenderError(null);

      try {
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch {
            // Ignore cancel rejection
          }
          renderTaskRef.current = null;
        }

        const page = await pdfDoc.getPage(currentPage);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        const containerWidth = canvasScrollRef.current?.clientWidth
          ? Math.max(260, canvasScrollRef.current.clientWidth - 32)
          : 560;
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = Math.min(1.35, Math.max(0.55, containerWidth / baseViewport.width));
        const effectiveScale = fitScale * zoomMultiplier;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: effectiveScale });
        const scaledViewport = page.getViewport({ scale: effectiveScale * dpr });

        canvas.width = Math.floor(scaledViewport.width);
        canvas.height = Math.floor(scaledViewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const task = page.render({
          canvas,
          canvasContext: context,
          viewport: scaledViewport,
        });
        renderTaskRef.current = task;
        await task.promise;
        if (!cancelled) {
          setIsRendering(false);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : '';
        if (name === 'RenderingCancelledException') return;
        setRenderError('Could not render this PDF page.');
        setIsRendering(false);
      }
    };

    void renderPage();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // Ignore
        }
        renderTaskRef.current = null;
      }
    };
  }, [isOpen, pdfDoc, currentPage, totalPages, zoomMultiplier]);

  if (!isOpen) return null;

  const canPrev = currentPage > 1;
  const canNext = currentPage < totalPages;

  return (
    <aside
      aria-label="PDF source viewer"
      data-testid="pdf-viewer-drawer"
      className="fixed inset-0 z-50 lg:static lg:z-auto lg:w-[46%] lg:max-w-[680px] bg-white lg:border-l border-slate-200 flex flex-col min-w-0"
    >
      {/* Viewer top bar */}
      <div className="h-14 shrink-0 px-4 border-b border-slate-200 flex items-center justify-between gap-2 bg-white">
        <div className="min-w-0 flex items-center gap-2">
          {citation && (
            <span className="font-mono font-semibold text-sm text-blue-800 whitespace-nowrap shrink-0">
              {citation.questionId}
            </span>
          )}
          {citation && (
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
          )}
          <span
            className="font-mono tabular-nums text-xs sm:text-sm text-slate-700 whitespace-nowrap shrink-0"
            data-testid="pdf-viewer-page-indicator"
          >
            Page {currentPage} of {totalPages}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => canPrev && onChangePage(currentPage - 1)}
            disabled={!canPrev}
            aria-label="Previous PDF page"
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => canNext && onChangePage(currentPage + 1)}
            disabled={!canNext}
            aria-label="Next PDF page"
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>

          <span className="w-px h-5 bg-slate-200 mx-1 hidden sm:inline-block" aria-hidden="true" />

          <button
            type="button"
            onClick={() => setZoomMultiplier((s) => Math.max(0.7, Number((s - 0.15).toFixed(2))))}
            aria-label="Zoom out PDF"
            className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <ZoomOut className="w-4 h-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setZoomMultiplier((s) => Math.min(2.0, Number((s + 0.15).toFixed(2))))}
            aria-label="Zoom in PDF"
            className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <ZoomIn className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close PDF viewer"
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors ml-1"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Original extracted passage box */}
      {citation && (
        <div className="shrink-0 border-b border-slate-200 bg-slate-50">
          <button
            type="button"
            onClick={() => setShowPassage((v) => !v)}
            aria-expanded={showPassage}
            className="w-full px-4 py-2.5 flex items-center justify-between gap-2 text-left text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors"
          >
            <span>
              Original passage · {citation.questionId} ({formatPageRange(citation.pageStart, citation.pageEnd)})
            </span>
            {showPassage ? (
              <ChevronUp className="w-4 h-4 shrink-0 text-slate-500" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-4 h-4 shrink-0 text-slate-500" aria-hidden="true" />
            )}
          </button>

          {showPassage && (
            <div
              className="px-4 pb-3.5 max-h-44 overflow-y-auto text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-wrap border-t border-slate-200/70 pt-2.5"
              data-testid="pdf-original-passage"
            >
              {citation.originalPassage}
            </div>
          )}
        </div>
      )}

      {/* Rendered PDF Page Canvas */}
      <div
        ref={canvasScrollRef}
        className="flex-1 overflow-auto bg-slate-100 p-4 flex flex-col items-center"
      >
        {renderError ? (
          <div className="my-8 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {renderError}
          </div>
        ) : (
          <div className="relative bg-white shadow-sm border border-slate-200 rounded-sm">
            {isRendering && (
              <div className="absolute inset-0 bg-white/75 flex items-center justify-center z-10">
                <Loader2 className="w-5 h-5 animate-spin text-blue-700" aria-hidden="true" />
              </div>
            )}
            <canvas
              ref={canvasRef}
              data-testid="pdf-page-canvas"
              className="block max-w-full h-auto"
            />
          </div>
        )}
      </div>
    </aside>
  );
}
