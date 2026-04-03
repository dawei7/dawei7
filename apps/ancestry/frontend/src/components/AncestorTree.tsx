/**
 * AncestorTree — D3 v7 pedigree tree as a React component.
 *
 * Patterns used:
 *  - React owns all logical state (collapse map, pending selection, filter).
 *  - D3 owns SVG pixels: rendering runs inside useEffect with a stable containerRef.
 *  - Zoom/pan transform is preserved in a ref so re-renders don't jump the viewport.
 *  - Filter state is persisted to sessionStorage keyed by person ID.
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import type { TreeNode } from '../lib/types';

// ── Layout constants ─────────────────────────────────────────────────────────
const NODE_W = 200;
const NODE_H = 56;
const GAP_X = 72;
const GAP_Y = 14;
const DEFAULT_COLLAPSE_DEPTH = 3;

// ── Types ────────────────────────────────────────────────────────────────────
type HierarchyNode = d3.HierarchyNode<TreeNode> & {
  _allChildren?: HierarchyNode[];
};

interface FilterState {
  activeFilter: Set<string> | null;
  filterHistory: Array<Set<string> | null>;
}

function loadFilterState(storeKey: string): FilterState {
  try {
    const raw = sessionStorage.getItem(storeKey);
    if (!raw) return { activeFilter: null, filterHistory: [] };
    const s = JSON.parse(raw) as {
      f: string[] | null;
      h: Array<string[] | null>;
    };
    return {
      activeFilter: s.f ? new Set(s.f) : null,
      filterHistory: (s.h ?? []).map((a) => (a ? new Set(a) : null)),
    };
  } catch {
    return { activeFilter: null, filterHistory: [] };
  }
}

function saveFilterState(storeKey: string, state: FilterState) {
  try {
    sessionStorage.setItem(
      storeKey,
      JSON.stringify({
        f: state.activeFilter ? [...state.activeFilter] : null,
        h: state.filterHistory.map((s) => (s ? [...s] : null)),
      }),
    );
  } catch {
    // sessionStorage may be unavailable
  }
}

// ── Ancestor reachability ────────────────────────────────────────────────────
function computeReachable(
  seeds: Set<string>,
  universe: Set<string>,
  links: Array<d3.HierarchyLink<TreeNode>>,
): Set<string> {
  const bySrc: Record<string, string[]> = {};
  const byTgt: Record<string, string[]> = {};
  for (const l of links) {
    const s = l.source.data.id;
    const t = l.target.data.id;
    (bySrc[s] ??= []).push(t);
    (byTgt[t] ??= []).push(s);
  }
  const visible = new Set<string>();
  for (const selID of seeds) {
    if (!universe.has(selID)) continue;
    // Expand descendants (ancestors in tree terms)
    const q = [selID];
    while (q.length) {
      const cur = q.shift()!;
      if (visible.has(cur)) continue;
      visible.add(cur);
      for (const tgt of bySrc[cur] ?? []) {
        if (!visible.has(tgt) && universe.has(tgt)) q.push(tgt);
      }
    }
    // Walk up to root
    let cur = selID;
    for (;;) {
      const srcs = byTgt[cur];
      if (!srcs?.length) break;
      const src = srcs[0];
      if (!universe.has(src)) break;
      visible.add(src);
      cur = src;
    }
  }
  return visible;
}

// ── Component ────────────────────────────────────────────────────────────────
interface Props {
  data: TreeNode;
  rootId: string;
}

export default function AncestorTree({ data, rootId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // D3 mutable refs — not React state, so they don't trigger re-renders
  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const transformRef = useRef<d3.ZoomTransform | null>(null);
  const hierarchyRef = useRef<HierarchyNode | null>(null);
  const allNodesMapRef = useRef<Map<string, HierarchyNode>>(new Map());

  // Collapse map: node ID → true means collapsed.
  // We store collapse state separately so D3 hierarchy can be rebuilt cleanly.
  const [collapseMap, setCollapseMap] = useState<ReadonlySet<string>>(() => {
    // Nodes at depth >= DEFAULT_COLLAPSE_DEPTH start collapsed
    const m = new Set<string>();
    function walk(node: TreeNode, depth: number) {
      if (depth >= DEFAULT_COLLAPSE_DEPTH && node.children?.length) m.add(node.id);
      for (const child of node.children ?? []) walk(child, depth + 1);
    }
    walk(data, 0);
    return m;
  });

  // Filter / selection state
  const storeKey = `tree-d3-${rootId}`;
  const [filterState, setFilterState] = useState<FilterState>(() =>
    loadFilterState(storeKey),
  );
  const [pending, setPending] = useState<Set<string>>(new Set());

  // Persist filter state on change
  useEffect(() => {
    saveFilterState(storeKey, filterState);
  }, [storeKey, filterState]);

  // ── Build D3 hierarchy from data + collapseMap ──────────────────────────
  const buildHierarchy = useCallback(() => {
    const hier = d3.hierarchy<TreeNode>(data, (d) => d.children ?? []) as HierarchyNode;
    const allNodes = hier.descendants() as HierarchyNode[];

    // Back up all children before collapsing
    for (const node of allNodes) {
      if (node.children?.length) {
        node._allChildren = [...node.children] as HierarchyNode[];
      }
    }
    // Apply collapse state
    for (const node of allNodes) {
      if (collapseMap.has(node.data.id) && node._allChildren) {
        node.children = undefined;
      }
    }

    const map = new Map<string, HierarchyNode>();
    for (const node of hier.descendants() as HierarchyNode[]) {
      map.set(node.data.id, node);
    }
    // Restore map entries for collapsed branches too
    function indexAll(n: HierarchyNode) {
      map.set(n.data.id, n);
      for (const c of n._allChildren ?? []) indexAll(c as HierarchyNode);
    }
    indexAll(hier);

    hierarchyRef.current = hier;
    allNodesMapRef.current = map;
    return hier;
  }, [data, collapseMap]);

  // ── Toggle collapse on a node ───────────────────────────────────────────
  const toggleNode = useCallback((nodeId: string) => {
    setCollapseMap((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
    setPending(new Set()); // clear pending on structural change
  }, []);

  // ── Filter actions ──────────────────────────────────────────────────────
  const applySelection = useCallback(() => {
    if (!pending.size) return;
    setFilterState((prev) => {
      const allIds = new Set(
        (hierarchyRef.current?.descendants() ?? []).map((n) => n.data.id),
      );
      const links = hierarchyRef.current?.links() ?? [];
      const universe = prev.activeFilter
        ? new Set([...prev.activeFilter].filter((id) => allIds.has(id)))
        : allIds;
      const next = computeReachable(pending, universe, links);
      return { activeFilter: next, filterHistory: [...prev.filterHistory, prev.activeFilter] };
    });
    setPending(new Set());
  }, [pending]);

  const stepBack = useCallback(() => {
    setFilterState((prev) => {
      const history = [...prev.filterHistory];
      const restored = history.pop() ?? null;
      return { activeFilter: restored, filterHistory: history };
    });
    setPending(new Set());
  }, []);

  const clearFilter = useCallback(() => {
    setFilterState({ activeFilter: null, filterHistory: [] });
    setPending(new Set());
  }, []);

  // ── D3 render ───────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Init SVG once
    if (!svgRef.current) {
      const top = container.getBoundingClientRect().top;
      const h = Math.max(400, window.innerHeight - top - 80);

      svgRef.current = d3
        .select(container)
        .append('svg')
        .attr('width', '100%')
        .attr('height', h) as d3.Selection<SVGSVGElement, unknown, null, undefined>;

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.05, 3])
        .on('zoom', (e: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          gRef.current?.attr('transform', e.transform.toString());
        });

      zoomRef.current = zoom;
      svgRef.current.call(zoom);
      gRef.current = svgRef.current.append('g') as d3.Selection<
        SVGGElement,
        unknown,
        null,
        undefined
      >;
    }

    const svg = svgRef.current;
    const g = gRef.current!;
    const zoom = zoomRef.current!;

    // Save current transform before re-render
    const svgNode = svg.node()!;
    const currentTransform = d3.zoomTransform(svgNode);
    const hadNodes = !g.selectAll('.tb').empty();
    if (hadNodes) transformRef.current = currentTransform;

    // Rebuild hierarchy
    const hier = buildHierarchy();
    g.selectAll('*').remove();
    d3.tree<TreeNode>().nodeSize([NODE_H + GAP_Y, NODE_W + GAP_X])(hier);

    const nodes = hier.descendants() as HierarchyNode[];
    const links = hier.links();

    // ── Links ──────────────────────────────────────────────────────────────
    g.append('g')
      .selectAll('path')
      .data(links)
      .join('path')
      .attr('class', 'tree-link')
      .attr('data-src', (d) => d.source.data.id)
      .attr('data-tgt', (d) => d.target.data.id)
      .attr('d', (d) => {
        const sx = d.source.y + NODE_W;
        const sy = d.source.x;
        const tx = d.target.y;
        const ty = d.target.x;
        const mx = (sx + tx) / 2;
        return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
      })
      .attr('fill', 'none')
      .attr('stroke', '#3f3f46')
      .attr('stroke-width', 1.5);

    // ── Node groups ────────────────────────────────────────────────────────
    const nodeG = g
      .append('g')
      .selectAll<SVGGElement, HierarchyNode>('g')
      .data(nodes)
      .join('g')
      .attr('class', 'tb')
      .attr('data-person-id', (d) => d.data.id)
      .attr('transform', (d) => `translate(${d.y},${d.x - NODE_H / 2})`)
      .style('cursor', 'pointer')
      .on('click', (_e, d) => {
        setPending((prev) => {
          const next = new Set(prev);
          if (next.has(d.data.id)) next.delete(d.data.id);
          else next.add(d.data.id);
          return next;
        });
      });

    // Box
    nodeG
      .append('rect')
      .attr('class', 'node-rect')
      .attr('width', NODE_W)
      .attr('height', NODE_H)
      .attr('rx', 6)
      .attr('fill', (d) =>
        d.data.sex === 'M' ? '#1a1f35' : d.data.sex === 'F' ? '#201a2d' : '#18181b',
      )
      .attr('stroke', '#52525b')
      .attr('stroke-width', 1.5);

    // Name
    nodeG
      .append('text')
      .attr('class', 'node-name')
      .attr('x', 10)
      .attr('y', 22)
      .attr('fill', '#e4e4e7')
      .attr('font-size', 13)
      .attr('font-weight', 500)
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .text((d) => clip(d.data.name, 23));

    // Dates
    nodeG
      .filter((d) => !!d.data.dates)
      .append('text')
      .attr('class', 'node-dates')
      .attr('x', 10)
      .attr('y', 40)
      .attr('fill', '#71717a')
      .attr('font-size', 11)
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .text((d) => d.data.dates ?? '');

    // Navigate icon ↗
    nodeG
      .append('text')
      .attr('class', 'nav-icon')
      .attr('x', NODE_W - 18)
      .attr('y', 17)
      .attr('fill', '#52525b')
      .attr('font-size', 14)
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .style('cursor', 'pointer')
      .attr('pointer-events', 'all')
      .text('↗')
      .on('click', (e, d) => {
        e.stopPropagation();
        window.location.href = `/person/${d.data.id}`;
      })
      .on('mouseenter', function () {
        d3.select(this).attr('fill', '#a78bfa');
      })
      .on('mouseleave', function () {
        d3.select(this).attr('fill', '#52525b');
      });

    // Expand/collapse toggle for nodes with ancestors
    const hasAncestors = nodeG.filter((d) => !!(d as HierarchyNode)._allChildren);

    const toggleG = hasAncestors
      .append('g')
      .attr('class', 'toggle-btn')
      .attr('transform', `translate(${NODE_W + 8},${NODE_H / 2})`)
      .style('cursor', 'pointer')
      .on('click', (e, d) => {
        e.stopPropagation();
        toggleNode(d.data.id);
      });

    toggleG
      .append('circle')
      .attr('class', 'toggle-circle')
      .attr('r', 9)
      .attr('fill', '#27272a')
      .attr('stroke', (d) => (d.children ? '#71717a' : '#7c3aed'))
      .attr('stroke-width', 1.5);

    toggleG
      .append('text')
      .attr('class', 'toggle-symbol')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', (d) => (d.children ? '#a1a1aa' : '#a78bfa'))
      .attr('font-size', 16)
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .text((d) => (d.children ? '−' : '+'));

    // Restore or center
    if (transformRef.current) {
      svg.call(zoom.transform, transformRef.current);
    } else {
      centerRoot(svg, zoom, nodes);
    }

    // Apply filter visuals
    applyVisuals(g, nodes, links, pending, filterState.activeFilter);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, collapseMap, buildHierarchy, toggleNode]);

  // Separate lighter effect for visual-only updates (pending/filter changes)
  useEffect(() => {
    const g = gRef.current;
    const hier = hierarchyRef.current;
    if (!g || !hier) return;
    const nodes = hier.descendants() as HierarchyNode[];
    const links = hier.links();
    applyVisuals(g, nodes, links, pending, filterState.activeFilter);
  }, [pending, filterState]);

  const showBar = pending.size > 0 || filterState.filterHistory.length > 0 || filterState.activeFilter !== null;

  return (
    <>
      <div ref={containerRef} className="w-full" />

      {showBar && (
        <div className="fixed bottom-0 left-0 right-0 bg-zinc-900/95 backdrop-blur border-t border-zinc-800 px-6 py-3 flex items-center gap-3">
          <span className="text-sm text-zinc-400 mr-auto">
            {pending.size > 0 ? `${pending.size} selected` : ''}
          </span>
          <button
            onClick={applySelection}
            disabled={pending.size === 0}
            className="text-xs px-3 py-1.5 rounded-lg border border-violet-700 text-violet-300 hover:border-violet-400 hover:text-violet-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Apply selection
          </button>
          <button
            onClick={stepBack}
            disabled={filterState.filterHistory.length === 0}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Step back
          </button>
          <button
            onClick={clearFilter}
            disabled={filterState.filterHistory.length === 0 && pending.size === 0 && filterState.activeFilter === null}
            className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:border-red-500 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Clear all
          </button>
        </div>
      )}
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clip(s: string, max: number): string {
  if (!s) return '';
  const runes = [...s];
  return runes.length <= max ? s : runes.slice(0, max - 1).join('') + '…';
}

function centerRoot(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  zoom: d3.ZoomBehavior<SVGSVGElement, unknown>,
  nodes: HierarchyNode[],
) {
  const svgNode = svg.node()!;
  const h = svgNode.clientHeight || svgNode.getBoundingClientRect().height || 600;
  const xs = nodes.map((n) => n.x);
  const xCenter = (Math.min(...xs) + Math.max(...xs)) / 2;
  svg.call(zoom.transform, d3.zoomIdentity.translate(48, h / 2 - xCenter));
}

function applyVisuals(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  nodes: HierarchyNode[],
  links: Array<d3.HierarchyLink<TreeNode>>,
  pending: Set<string>,
  activeFilter: Set<string> | null,
) {
  const allIds = new Set(nodes.map((n) => n.data.id));
  const universe = activeFilter
    ? new Set([...activeFilter].filter((id) => allIds.has(id)))
    : allIds;
  const preview = pending.size ? computeReachable(pending, universe, links) : null;

  g.selectAll<SVGGElement, HierarchyNode>('.tb').each(function (d) {
    const id = d.data.id;
    const inU = universe.has(id);
    const sel = d3.select(this);
    sel.style('display', inU ? null : 'none');
    sel.style('opacity', preview ? (preview.has(id) ? 1 : 0.08) : 1);

    const isPending = pending.has(id);
    sel
      .select('.node-rect')
      .attr('stroke', isPending ? '#7c3aed' : '#52525b')
      .attr('stroke-width', isPending ? 2 : 1.5)
      .attr(
        'fill',
        isPending
          ? '#1e1b4b'
          : d.data.sex === 'M'
            ? '#1a1f35'
            : d.data.sex === 'F'
              ? '#201a2d'
              : '#18181b',
      );
    sel.select('.node-name').attr('fill', isPending ? '#c4b5fd' : '#e4e4e7');
  });

  g.selectAll<SVGPathElement, d3.HierarchyLink<TreeNode>>('.tree-link').each(function (d) {
    const inU = universe.has(d.source.data.id) && universe.has(d.target.data.id);
    const el = d3.select(this);
    el.style('display', inU ? null : 'none');
    el.style(
      'opacity',
      preview
        ? preview.has(d.source.data.id) && preview.has(d.target.data.id)
          ? 1
          : 0.05
        : 1,
    );
  });
}
