/**
 * AncestorTree — D3 v7 pedigree tree as a React component.
 *
 * - Ancestor direction: always 3 generations visible (collapsible beyond that).
 * - Each node has an OPEN vertical tab to navigate to the person page.
 * - Each node has a siblings button that expands a sibling panel below the tree.
 * - No selection/filter system.
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import type { TreeNode, Person } from '../lib/types';
import { fetchSiblings } from '../lib/api';

// ── Layout constants ─────────────────────────────────────────────────────────
const NODE_W = 220;
const NODE_H = 72;
const TAB_W = 32;
const GAP_X = 80;
const GAP_Y = 10;
const DEFAULT_COLLAPSE_DEPTH = 3;

// Sex colours
const SEX_FILL: Record<string, string> = {
  M: '#0f1e38',
  F: '#1e0f2a',
  '': '#18181b',
};
const SEX_STRIPE: Record<string, string> = {
  M: '#1d4ed8',
  F: '#9333ea',
  '': '#3f3f46',
};

// ── Types ────────────────────────────────────────────────────────────────────
type HierarchyNode = d3.HierarchyNode<TreeNode> & {
  _allChildren?: HierarchyNode[];
};

interface SiblingPanel {
  personId: string;
  name: string;
  siblings: Person[];
  loading: boolean;
  error: string | null;
}

// ── Component ────────────────────────────────────────────────────────────────
interface Props {
  data: TreeNode;
  rootId: string;
  descendants?: TreeNode;
}

export default function AncestorTree({ data, rootId, descendants }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  const svgRef = useRef<d3.Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const transformRef = useRef<d3.ZoomTransform | null>(null);
  const hierarchyRef = useRef<HierarchyNode | null>(null);
  const rootIdRef = useRef(rootId);
  useEffect(() => { rootIdRef.current = rootId; }, [rootId]);

  // Reset SVG when the root person changes (new tree page)
  const prevRootIdRef = useRef(rootId);
  if (prevRootIdRef.current !== rootId) {
    prevRootIdRef.current = rootId;
    if (svgRef.current && containerRef.current) {
      containerRef.current.innerHTML = '';
    }
    svgRef.current = null;
    gRef.current = null;
    zoomRef.current = null;
    transformRef.current = null;
  }

  const [collapseMap, setCollapseMap] = useState<ReadonlySet<string>>(() => {
    const m = new Set<string>();
    function walk(node: TreeNode, depth: number) {
      if (depth >= DEFAULT_COLLAPSE_DEPTH && node.children?.length) m.add(node.id);
      for (const child of node.children ?? []) walk(child, depth + 1);
    }
    walk(data, 0);
    return m;
  });

  const [siblingPanel, setSiblingPanel] = useState<SiblingPanel | null>(null);

  // Descendant collapse map (depth ≥ DEFAULT_COLLAPSE_DEPTH collapsed)
  const [descCollapseMap, setDescCollapseMap] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!descendants) return;
    const m = new Set<string>();
    function walkDesc(node: TreeNode, depth: number) {
      if (depth >= DEFAULT_COLLAPSE_DEPTH && node.children?.length) m.add(node.id);
      for (const child of node.children ?? []) walkDesc(child, depth + 1);
    }
    walkDesc(descendants, 0);
    setDescCollapseMap(m);
  }, [descendants]);

  const buildHierarchy = useCallback(() => {
    const hier = d3.hierarchy<TreeNode>(data, (d) => d.children ?? []) as HierarchyNode;
    const allNodes = hier.descendants() as HierarchyNode[];
    for (const node of allNodes) {
      if (node.children?.length) node._allChildren = [...node.children] as HierarchyNode[];
    }
    for (const node of allNodes) {
      if (collapseMap.has(node.data.id) && node._allChildren) node.children = undefined;
    }
    hierarchyRef.current = hier;
    return hier;
  }, [data, collapseMap]);

  const toggleNode = useCallback((nodeId: string) => {
    setCollapseMap((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const toggleDescNode = useCallback((nodeId: string) => {
    setDescCollapseMap((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const openSiblings = useCallback((personId: string, name: string) => {
    setSiblingPanel((prev) => {
      if (prev?.personId === personId) return null;
      return { personId, name, siblings: [], loading: true, error: null };
    });
    fetchSiblings(personId)
      .then((siblings) => {
        setSiblingPanel((prev) =>
          prev?.personId === personId ? { ...prev, siblings, loading: false } : prev,
        );
      })
      .catch((err: unknown) => {
        setSiblingPanel((prev) =>
          prev?.personId === personId
            ? { ...prev, loading: false, error: err instanceof Error ? err.message : 'Failed' }
            : prev,
        );
      });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
      gRef.current = svgRef.current.append('g') as d3.Selection<SVGGElement, unknown, null, undefined>;
    }

    const svg = svgRef.current;
    const g = gRef.current!;
    const zoom = zoomRef.current!;

    if (!g.selectAll('.tb').empty()) transformRef.current = d3.zoomTransform(svg.node()!);

    const hier = buildHierarchy();
    g.selectAll('*').remove();
    d3.tree<TreeNode>().nodeSize([NODE_H + GAP_Y, NODE_W + GAP_X])(hier);

    const nodes = hier.descendants() as HierarchyNode[];
    const links = hier.links();

    // -- Descendant tree (LEFT side, mirrored) --
    if (descendants) {
      const descHier = d3.hierarchy<TreeNode>(descendants, (d) => d.children ?? []) as HierarchyNode;
      const descAll = descHier.descendants() as HierarchyNode[];
      for (const n of descAll) {
        if (n.children?.length) n._allChildren = [...n.children] as HierarchyNode[];
      }
      for (const n of descAll) {
        if (descCollapseMap.has(n.data.id) && n._allChildren) n.children = undefined;
      }
      d3.tree<TreeNode>().nodeSize([NODE_H + GAP_Y, NODE_W + GAP_X])(descHier);

      // Links: mirror horizontally (parent left-edge → child right-edge, going left)
      g.append('g')
        .selectAll('path')
        .data(descHier.links())
        .join('path')
        .attr('fill', 'none').attr('stroke', '#3f3f46').attr('stroke-width', 1.5)
        .attr('d', (d) => {
          const sx = -d.source.y!;
          const sy = d.source.x!;
          const tx = -d.target.y! + NODE_W;
          const ty = d.target.x!;
          const mx = (sx + tx) / 2;
          return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
        });

      // Descendant nodes (skip depth=0 = root, already shown as ancestor root)
      const descNodes = (descHier.descendants() as HierarchyNode[]).filter((d) => d.depth > 0);
      const descNodeG = g
        .append('g')
        .selectAll<SVGGElement, HierarchyNode>('g')
        .data(descNodes)
        .join('g')
        .attr('class', 'dsc')
        .attr('data-person-id', (d) => d.data.id)
        .attr('transform', (d) => `translate(${-d.y!},${d.x! - NODE_H / 2})`);

      descNodeG.append('rect')
        .attr('width', NODE_W).attr('height', NODE_H).attr('rx', 6)
        .attr('fill', (d) => SEX_FILL[d.data.sex ?? ''] ?? SEX_FILL[''])
        .attr('stroke', (d) => (d.data.id === rootIdRef.current ? '#ca8a04' : '#52525b'))
        .attr('stroke-width', (d) => (d.data.id === rootIdRef.current ? 2 : 1.5));

      descNodeG.append('rect')
        .attr('width', 3).attr('height', NODE_H - 12)
        .attr('x', 0).attr('y', 6).attr('rx', 1.5)
        .attr('fill', (d) => SEX_STRIPE[d.data.sex ?? ''] ?? SEX_STRIPE[''])
        .attr('pointer-events', 'none');

      descNodeG.append('text')
        .attr('x', 10).attr('y', 22).attr('fill', '#e4e4e7')
        .attr('font-size', 13).attr('font-weight', 500)
        .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
        .attr('pointer-events', 'none').text((d) => clip(d.data.name, 18));

      descNodeG.filter((d) => !!d.data.dates).append('text')
        .attr('x', 10).attr('y', 40).attr('fill', '#71717a').attr('font-size', 11)
        .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
        .attr('pointer-events', 'none').text((d) => d.data.dates ?? '');

      // OPEN tab - right side
      const descNavG = descNodeG.append('g')
        .attr('transform', `translate(${NODE_W - TAB_W}, 0)`)
        .style('cursor', 'pointer')
        .on('click', (e, d) => { e.stopPropagation(); window.location.href = `/person/${d.data.id}`; })
        .on('mouseenter', function () {
          d3.select(this).select('.dnav-bg').attr('fill', '#5b21b6');
          d3.select(this).select('.dnav-lbl').attr('fill', '#ffffff');
        })
        .on('mouseleave', function () {
          d3.select(this).select('.dnav-bg').attr('fill', '#27272a');
          d3.select(this).select('.dnav-lbl').attr('fill', '#a78bfa');
        });
      descNavG.append('rect').attr('class', 'dnav-bg')
        .attr('x', 1).attr('y', 1).attr('width', TAB_W - 2).attr('height', NODE_H - 2)
        .attr('rx', 5).attr('fill', '#27272a');
      descNavG.append('text').attr('class', 'dnav-lbl')
        .attr('transform', `translate(${TAB_W / 2},${NODE_H / 2}) rotate(-90)`)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .attr('fill', '#a78bfa').attr('font-size', 11).attr('font-weight', 700)
        .attr('letter-spacing', '0.18em')
        .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
        .attr('pointer-events', 'none').text('OPEN');

      // Pass root param so person page can link back to current tree root
      descNavG.on('click', (e, d) => { e.stopPropagation(); window.location.href = `/person/${d.data.id}?root=${rootIdRef.current}`; });

      const dBtnY = NODE_H - 15;
      const dBtnH = 13;

      const dSibG = descNodeG.append('g').attr('transform', `translate(8,${dBtnY})`)
        .style('cursor', 'pointer')
        .on('click', (e, d) => { e.stopPropagation(); openSiblings(d.data.id, d.data.name); })
        .on('mouseenter', function () {
          d3.select(this).select('.dsib-bg').attr('fill', '#3b0764');
          d3.select(this).select('.dsib-lbl').attr('fill', '#e9d5ff');
        })
        .on('mouseleave', function () {
          d3.select(this).select('.dsib-bg').attr('fill', '#27272a');
          d3.select(this).select('.dsib-lbl').attr('fill', '#71717a');
        });
      dSibG.append('rect').attr('class', 'dsib-bg')
        .attr('width', 62).attr('height', dBtnH).attr('rx', 3)
        .attr('fill', (d) => d.data.has_siblings ? '#2e1065' : '#27272a');
      dSibG.append('text').attr('class', 'dsib-lbl')
        .attr('x', 31).attr('y', 10).attr('text-anchor', 'middle')
        .attr('fill', (d) => d.data.has_siblings ? '#a78bfa' : '#71717a')
        .attr('font-size', 9).attr('font-weight', 600).attr('letter-spacing', '0.06em')
        .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
        .attr('pointer-events', 'none').text('≡  SIBLINGS');

      const dRootG = descNodeG.append('g').attr('transform', `translate(76,${dBtnY})`)
        .style('cursor', 'pointer')
        .on('click', (e, d) => { e.stopPropagation(); window.location.href = `/tree/${d.data.id}`; })
        .on('mouseenter', function (_, d) {
          if (d.data.id === rootIdRef.current) return;
          d3.select(this).select('.dr-bg').attr('fill', '#14532d');
          d3.select(this).select('.dr-lbl').attr('fill', '#bbf7d0');
        })
        .on('mouseleave', function (_, d) {
          const isRoot = d.data.id === rootIdRef.current;
          d3.select(this).select('.dr-bg').attr('fill', isRoot ? '#166534' : '#27272a');
          d3.select(this).select('.dr-lbl').attr('fill', isRoot ? '#86efac' : '#71717a');
        });
      dRootG.append('rect').attr('class', 'dr-bg')
        .attr('width', 52).attr('height', dBtnH).attr('rx', 3)
        .attr('fill', (d) => (d.data.id === rootIdRef.current ? '#166534' : '#27272a'));
      dRootG.append('text').attr('class', 'dr-lbl')
        .attr('x', 26).attr('y', 10).attr('text-anchor', 'middle')
        .attr('fill', (d) => (d.data.id === rootIdRef.current ? '#86efac' : '#71717a'))
        .attr('font-size', 9).attr('font-weight', 600).attr('letter-spacing', '0.03em')
        .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
        .attr('pointer-events', 'none')
        .text((d) => (d.data.id === rootIdRef.current ? '⌂ ROOT' : '⌂ SET ROOT'));

      const hasDescChildren = descNodeG.filter((d) => !!(d as HierarchyNode)._allChildren);
      const descToggleG = hasDescChildren.append('g')
        .attr('transform', `translate(-17,${NODE_H / 2})`)
        .style('cursor', 'pointer')
        .on('click', (e, d) => { e.stopPropagation(); toggleDescNode(d.data.id); });
      descToggleG.append('circle').attr('r', 9).attr('fill', '#27272a')
        .attr('stroke', (d) => (d.children ? '#71717a' : '#7c3aed')).attr('stroke-width', 1.5);
      descToggleG.append('text').attr('text-anchor', 'middle').attr('dy', '0.35em')
        .attr('fill', (d) => (d.children ? '#a1a1aa' : '#a78bfa')).attr('font-size', 14)
        .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
        .attr('pointer-events', 'none').text((d) => (d.children ? '−' : '+'));
    }
    // -- End descendant tree --
    g.append('g')
      .selectAll('path')
      .data(links)
      .join('path')
      .attr('class', 'tree-link')
      .attr('d', (d) => {
        const sx = d.source.y! + NODE_W;
        const sy = d.source.x!;
        const tx = d.target.y!;
        const ty = d.target.x!;
        const mx = (sx + tx) / 2;
        return `M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
      })
      .attr('fill', 'none')
      .attr('stroke', '#3f3f46')
      .attr('stroke-width', 1.5);

    // Node groups
    const nodeG = g
      .append('g')
      .selectAll<SVGGElement, HierarchyNode>('g')
      .data(nodes)
      .join('g')
      .attr('class', 'tb')
      .attr('data-person-id', (d) => d.data.id)
      .attr('transform', (d) => `translate(${d.y!},${d.x! - NODE_H / 2})`);

    // Box
    nodeG
      .append('rect')
      .attr('width', NODE_W)
      .attr('height', NODE_H)
      .attr('rx', 6)
      .attr('fill', (d) => SEX_FILL[d.data.sex ?? ''] ?? SEX_FILL[''])
      .attr('stroke', '#52525b')
      .attr('stroke-width', 1.5);

    // Left sex-stripe
    nodeG
      .append('rect')
      .attr('width', 3)
      .attr('height', NODE_H - 12)
      .attr('x', 0)
      .attr('y', 6)
      .attr('rx', 1.5)
      .attr('fill', (d) => SEX_STRIPE[d.data.sex ?? ''] ?? SEX_STRIPE[''])
      .attr('pointer-events', 'none');

    // Name
    nodeG
      .append('text')
      .attr('x', 10)
      .attr('y', 22)
      .attr('fill', '#e4e4e7')
      .attr('font-size', 13)
      .attr('font-weight', 500)
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .text((d) => clip(d.data.name, 18));

    // Dates
    nodeG
      .filter((d) => !!d.data.dates)
      .append('text')
      .attr('x', 10)
      .attr('y', 40)
      .attr('fill', '#71717a')
      .attr('font-size', 11)
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .text((d) => d.data.dates ?? '');

    // ── Bottom button row (y = NODE_H - 15) ─────────────────────────────
    const BTN_Y = NODE_H - 15;
    const BTN_H2 = 13;

    // Siblings button — small pill at bottom-left
    const sibG = nodeG
      .append('g')
      .attr('class', (d) =>
        siblingPanel?.personId === d.data.id ? 'sib-btn sib-active' : 'sib-btn',
      )
      .attr('transform', `translate(8,${BTN_Y})`)
      .style('cursor', 'pointer')
      .on('click', (e, d) => {
        e.stopPropagation();
        openSiblings(d.data.id, d.data.name);
      })
      .on('mouseenter', function () {
        d3.select(this).select('.sib-bg').attr('fill', '#3b0764');
        d3.select(this).select('.sib-lbl').attr('fill', '#e9d5ff');
      })
      .on('mouseleave', function (_, d) {
        const isActive = siblingPanel?.personId === d.data.id;
        const hasSib = d.data.has_siblings;
        d3.select(this).select('.sib-bg').attr('fill', isActive ? '#4c1d95' : hasSib ? '#2e1065' : '#27272a');
        d3.select(this).select('.sib-lbl').attr('fill', isActive ? '#ddd6fe' : hasSib ? '#a78bfa' : '#71717a');
      });

    sibG
      .append('rect')
      .attr('class', 'sib-bg')
      .attr('width', 62)
      .attr('height', 13)
      .attr('rx', 3)
      .attr('fill', (d) => (siblingPanel?.personId === d.data.id ? '#4c1d95' : d.data.has_siblings ? '#2e1065' : '#27272a'));

    sibG
      .append('text')
      .attr('class', 'sib-lbl')
      .attr('x', 31)
      .attr('y', 10)
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => (siblingPanel?.personId === d.data.id ? '#ddd6fe' : d.data.has_siblings ? '#a78bfa' : '#71717a'))
      .attr('font-size', 9)
      .attr('font-weight', 600)
      .attr('letter-spacing', '0.06em')
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .text('≡  SIBLINGS');

    // "Set as root" button — pill to the right of siblings
    const rootBtnW = 58;
    const rootBtnX = 76;
    const rootG = nodeG
      .append('g')
      .attr('class', 'root-btn')
      .attr('transform', `translate(${rootBtnX},${BTN_Y})`)
      .style('cursor', 'pointer')
      .on('click', (e, d) => {
        e.stopPropagation();
        window.location.href = `/tree/${d.data.id}`;
      })
      .on('mouseenter', function (_, d) {
        if (d.data.id === rootIdRef.current) return;
        d3.select(this).select('.root-bg').attr('fill', '#14532d');
        d3.select(this).select('.root-lbl').attr('fill', '#bbf7d0');
      })
      .on('mouseleave', function (_, d) {
        const isRoot = d.data.id === rootIdRef.current;
        d3.select(this).select('.root-bg').attr('fill', isRoot ? '#166534' : '#27272a');
        d3.select(this).select('.root-lbl').attr('fill', isRoot ? '#86efac' : '#71717a');
      });

    rootG
      .append('rect')
      .attr('class', 'root-bg')
      .attr('width', rootBtnW)
      .attr('height', BTN_H2)
      .attr('rx', 3)
      .attr('fill', (d) => (d.data.id === rootIdRef.current ? '#166534' : '#27272a'));

    rootG
      .append('text')
      .attr('class', 'root-lbl')
      .attr('x', rootBtnW / 2)
      .attr('y', 10)
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => (d.data.id === rootIdRef.current ? '#86efac' : '#71717a'))
      .attr('font-size', 9)
      .attr('font-weight', 600)
      .attr('letter-spacing', '0.03em')
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .text((d) => (d.data.id === rootIdRef.current ? '⌂ ROOT' : '⌂ SET ROOT'));

    // Highlight current root node with a golden border
    nodeG
      .filter((d) => d.data.id === rootIdRef.current)
      .select('rect')
      .attr('stroke', '#ca8a04')
      .attr('stroke-width', 2);

    // Right-side vertical "OPEN" tab
    const navG = nodeG
      .append('g')
      .attr('transform', `translate(${NODE_W - TAB_W}, 0)`)
      .style('cursor', 'pointer')
      .on('click', (e, d) => {
        e.stopPropagation();
        window.location.href = `/person/${d.data.id}?root=${rootIdRef.current}`;
      })
      .on('mouseenter', function () {
        d3.select(this).select('.nav-bg').attr('fill', '#5b21b6');
        d3.select(this).select('.nav-lbl').attr('fill', '#ffffff');
      })
      .on('mouseleave', function () {
        d3.select(this).select('.nav-bg').attr('fill', '#27272a');
        d3.select(this).select('.nav-lbl').attr('fill', '#a78bfa');
      });

    navG
      .append('rect')
      .attr('class', 'nav-bg')
      .attr('x', 1).attr('y', 1)
      .attr('width', TAB_W - 2)
      .attr('height', NODE_H - 2)
      .attr('rx', 5)
      .attr('fill', '#27272a');

    navG
      .append('text')
      .attr('class', 'nav-lbl')
      .attr('transform', `translate(${TAB_W / 2},${NODE_H / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#a78bfa')
      .attr('font-size', 11)
      .attr('font-weight', 700)
      .attr('letter-spacing', '0.18em')
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .text('OPEN');

    // Expand/collapse toggle
    const hasAncestors = nodeG.filter((d) => !!(d as HierarchyNode)._allChildren);
    const toggleG = hasAncestors
      .append('g')
      .attr('transform', `translate(${NODE_W + 8},${NODE_H / 2})`)
      .style('cursor', 'pointer')
      .on('click', (e, d) => {
        e.stopPropagation();
        toggleNode(d.data.id);
      });

    toggleG
      .append('circle')
      .attr('r', 9)
      .attr('fill', '#27272a')
      .attr('stroke', (d) => (d.children ? '#71717a' : '#7c3aed'))
      .attr('stroke-width', 1.5);

    toggleG
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', (d) => (d.children ? '#a1a1aa' : '#a78bfa'))
      .attr('font-size', 14)
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .attr('pointer-events', 'none')
      .text((d) => (d.children ? '−' : '+'));

    if (transformRef.current) {
      svg.call(zoom.transform, transformRef.current);
    } else {
      centerRoot(svg, zoom, nodes, !!descendants);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, collapseMap, buildHierarchy, toggleNode, descendants, descCollapseMap, toggleDescNode]);

  // Sync siblings button highlight when panel changes
  useEffect(() => {
    const g = gRef.current;
    if (!g) return;
    g.selectAll<SVGGElement, HierarchyNode>('.tb').each(function (d) {
      const active = siblingPanel?.personId === d.data.id;
      d3.select(this).select('.sib-bg').attr('fill', active ? '#4c1d95' : '#27272a');
      d3.select(this).select('.sib-lbl').attr('fill', active ? '#ddd6fe' : '#71717a');
    });
  }, [siblingPanel]);

  return (
    <div>
      <div ref={containerRef} className="w-full" />

      {siblingPanel && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-700 bg-zinc-950/98 shadow-2xl">
          {/* Header bar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-200">
              Siblings of <span className="text-violet-300">{siblingPanel.name}</span>
            </h3>
            <button
              onClick={() => setSiblingPanel(null)}
              className="text-zinc-500 hover:text-zinc-200 text-xl leading-none px-1"
            >
              ×
            </button>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto max-h-[38vh] px-6 py-4">
            {siblingPanel.loading && <p className="text-zinc-500 text-sm">Loading…</p>}
            {siblingPanel.error && <p className="text-red-400 text-sm">{siblingPanel.error}</p>}
            {!siblingPanel.loading && !siblingPanel.error && siblingPanel.siblings.length === 0 && (
              <p className="text-zinc-500 text-sm">No siblings found.</p>
            )}

            {siblingPanel.siblings.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {siblingPanel.siblings.map((sib) => (
                  <div
                    key={sib.id}
                    className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2"
                  >
                    <span
                      className="w-1.5 h-8 rounded-full shrink-0"
                      style={{ background: SEX_STRIPE[sib.sex ?? ''] ?? SEX_STRIPE[''] }}
                    />
                    <div className="overflow-hidden flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-200 truncate">
                        {sib.first_name} {sib.last_name}
                      </div>
                      {sib.birth_date && (
                        <div className="text-[10px] text-zinc-500 truncate">b. {sib.birth_date}</div>
                      )}
                      <div className="flex gap-1 mt-1.5">
                        <a
                          href={`/tree/${sib.id}`}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 hover:bg-emerald-800 transition-colors"
                        >
                          🌳 Root
                        </a>
                        <a
                          href={`/person/${sib.id}`}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
                        >
                          Profile
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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
  _hasBothSides: boolean,
) {
  const svgNode = svg.node()!;
  const h = svgNode.clientHeight || svgNode.getBoundingClientRect().height || 600;
  const xs = nodes.map((n) => n.x ?? 0);
  const xCenter = (Math.min(...xs) + Math.max(...xs)) / 2;
  // Always start root near left edge; descendants are below, not right
  svg.call(zoom.transform, d3.zoomIdentity.translate(48, h / 2 - xCenter));
}
