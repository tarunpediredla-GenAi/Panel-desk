import { Upload, Trash2 } from 'lucide-react';
import type { PdfIndex } from '../types';

interface TopBarProps {
  pdfIndex: PdfIndex | null;
  isIndexing: boolean;
  onTriggerUpload: () => void;
  onClearPdf: () => void;
}

export function TopBar({
  pdfIndex,
  isIndexing,
  onTriggerUpload,
  onClearPdf,
}: TopBarProps) {
  return (
    <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-6 min-w-0">
        <span className="font-[var(--font-display)] text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          PanelDesk
        </span>

        {pdfIndex && (
          <div
            className="hidden md:flex items-center gap-2 text-xs text-slate-500 min-w-0"
            data-testid="pdf-summary-bar"
          >
            <span className="truncate max-w-[260px] text-slate-700 font-medium" title={pdfIndex.fileName}>
              {pdfIndex.fileName}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
              {pdfIndex.questions.length} {pdfIndex.questions.length === 1 ? 'question' : 'questions'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
              {pdfIndex.pageCount} {pdfIndex.pageCount === 1 ? 'page' : 'pages'}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {pdfIndex && !isIndexing && (
          <button
            type="button"
            onClick={onClearPdf}
            aria-label="Remove uploaded PDF"
            title="Remove uploaded PDF"
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={onTriggerUpload}
          disabled={isIndexing}
          className={`h-9 px-3.5 inline-flex items-center gap-2 rounded-lg text-xs sm:text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
            pdfIndex
              ? 'bg-slate-900 text-white hover:bg-slate-800'
              : 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50'
          }`}
        >
          <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Upload interview PDF</span>
        </button>
      </div>
    </header>
  );
}
