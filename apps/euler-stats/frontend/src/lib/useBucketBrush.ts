import { useCallback, useRef, useState } from 'react';

interface UseBucketBrushOptions {
  count: number;
  marginLeft: number;
  plotW: number;
  onSelectRange?: (loIdx: number, hiIdx: number) => void;
}

interface ActivePointer {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  startIdx: number;
  curIdx: number;
  isDragging: boolean;
  touchMoved: boolean;
}

/**
 * Shared SVG chart interaction hook: hover inspection, tap/click to select a bucket,
 * and mouse horizontal drag-brush to select a bucket range.
 */
export function useBucketBrush({
  count,
  marginLeft,
  plotW,
  onSelectRange,
}: UseBucketBrushOptions) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [dragBand, setDragBand] = useState<{ loIdx: number; hiIdx: number } | null>(null);
  const ptrRef = useRef<ActivePointer | null>(null);

  const indexAtClientX = useCallback(
    (clientX: number, rectLeft: number, clampToBounds: boolean): number | null => {
      if (count <= 0) return null;
      const relX = clientX - rectLeft - marginLeft;
      if (!clampToBounds && (relX < 0 || relX > plotW)) return null;
      const clamped = Math.max(0, Math.min(plotW - 0.001, relX));
      const step = plotW / count;
      return Math.min(count - 1, Math.max(0, Math.floor(clamped / step)));
    },
    [count, marginLeft, plotW],
  );

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const idx = indexAtClientX(e.clientX, rect.left, false);
    if (idx === null) return;

    setHoverIdx(idx);
    ptrRef.current = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      startIdx: idx,
      curIdx: idx,
      isDragging: false,
      touchMoved: false,
    };
    if (e.pointerType === 'mouse' && onSelectRange) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore unsupported capture
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = ptrRef.current;

    if (p && p.pointerId === e.pointerId) {
      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;
      if (p.pointerType === 'mouse') {
        const idx = indexAtClientX(e.clientX, rect.left, true);
        if (idx !== null) {
          setHoverIdx(idx);
          p.curIdx = idx;
          if (!p.isDragging && Math.abs(dx) >= 8 && onSelectRange) {
            p.isDragging = true;
          }
          if (p.isDragging) {
            setDragBand({
              loIdx: Math.min(p.startIdx, idx),
              hiIdx: Math.max(p.startIdx, idx),
            });
          }
        }
        return;
      }

      if (Math.hypot(dx, dy) > 12) {
        p.touchMoved = true;
      }
      const idx = indexAtClientX(e.clientX, rect.left, false);
      if (idx !== null) setHoverIdx(idx);
      return;
    }

    const idx = indexAtClientX(e.clientX, rect.left, false);
    setHoverIdx(idx);
  };

  const finishPointer = (e: React.PointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const p = ptrRef.current;
    if (!p || p.pointerId !== e.pointerId) return;
    ptrRef.current = null;
    setDragBand(null);

    if (p.pointerType === 'mouse') {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    }

    if (cancelled || !onSelectRange) return;

    if (p.pointerType === 'mouse') {
      const lo = Math.min(p.startIdx, p.curIdx);
      const hi = Math.max(p.startIdx, p.curIdx);
      onSelectRange(lo, hi);
    } else if (!p.touchMoved) {
      onSelectRange(p.startIdx, p.startIdx);
    }
  };

  const onPointerLeave = () => {
    if (!ptrRef.current) {
      setHoverIdx(null);
    }
  };

  return {
    hoverIdx,
    setHoverIdx,
    dragBand,
    isDragging: dragBand !== null,
    svgHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => finishPointer(e, false),
      onPointerCancel: (e: React.PointerEvent<SVGSVGElement>) => finishPointer(e, true),
      onPointerLeave,
    },
  };
}
