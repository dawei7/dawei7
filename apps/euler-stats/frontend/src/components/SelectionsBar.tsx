export interface SelectionChip {
  key: string;
  label: string;
  value: string;
  onClear: () => void;
}

interface SelectionsBarProps {
  chips: SelectionChip[];
  onClearAll: () => void;
  hint?: string;
}

/**
 * Qlik-style active selections strip displayed cleanly above charts and tables.
 */
export function SelectionsBar({ chips, onClearAll, hint }: SelectionsBarProps) {
  if (chips.length === 0) {
    if (!hint) return null;
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[#e3dccb] bg-[#fffcf6]/70 px-3.5 py-2 text-[11px] sm:text-xs text-[#6e6558]">
        <span className="h-2 w-2 rounded-full bg-[#1e4636] shrink-0" />
        <span>{hint}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#1e4636]/30 bg-[#1e4636]/8 px-3.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-[#1e4636] mr-1">
          Selections
        </span>
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={c.onClear}
            title={`Clear ${c.label}: ${c.value}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#1e4636] px-2.5 py-1 text-[11px] font-medium text-[#faf7f1] hover:bg-[#143028] transition-colors cursor-pointer"
          >
            <span className="text-[#cde0d5]">{c.label}:</span>
            <span className="truncate max-w-[180px]">{c.value}</span>
            <span aria-hidden="true" className="text-[#cde0d5] hover:text-white ml-0.5">
              ×
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onClearAll}
        className="shrink-0 rounded-full border border-[#1e4636]/35 bg-[#fffcf6] px-2.5 py-1 text-[11px] font-medium text-[#1e4636] hover:bg-[#1e4636] hover:text-[#faf7f1] transition-colors cursor-pointer"
      >
        Clear all
      </button>
    </div>
  );
}
