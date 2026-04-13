import type { RecoverableTerminalSessionSnapshot } from './pty-session-recovery';
import type { TiledLayout } from './tiled-layout';

export type TiledPaneSplitAxis = 'horizontal' | 'vertical';
export type TiledPaneTreePath = number[];
export type TiledPaneDirection = 'left' | 'right' | 'up' | 'down';

export interface TiledPaneSlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TiledPaneSlotNode {
  type: 'slot';
  slotId: string;
}

export interface TiledPaneSplitNode {
  type: 'split';
  axis: TiledPaneSplitAxis;
  ratio: number;
  children: [TiledPaneTreeNode, TiledPaneTreeNode];
}

export type TiledPaneTreeNode = TiledPaneSlotNode | TiledPaneSplitNode;

export interface TiledPaneSlotBinding {
  slotId: string;
  sessionId?: string;
  terminalRecovery?: RecoverableTerminalSessionSnapshot;
}

export interface SplitTiledPaneSlotResult {
  tree: TiledPaneTreeNode;
  newSlotId: string;
}

const MIN_SPLIT_RATIO = 0.15;
const MAX_SPLIT_RATIO = 0.85;

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value));
}

function createSlotNode(slotId: string): TiledPaneSlotNode {
  return {
    type: 'slot',
    slotId,
  };
}

function getMaxSlotNumber(tree: TiledPaneTreeNode): number {
  return flattenTiledPaneTreeSlotIds(tree).reduce((maxValue, slotId) => {
    const match = /^slot-(\d+)$/.exec(slotId);
    if (!match) {
      return maxValue;
    }
    const nextValue = Number.parseInt(match[1] ?? '', 10);
    return Number.isFinite(nextValue) ? Math.max(maxValue, nextValue) : maxValue;
  }, 0);
}

function cloneSlotBinding(binding: TiledPaneSlotBinding): TiledPaneSlotBinding {
  return {
    slotId: binding.slotId,
    ...(binding.sessionId ? { sessionId: binding.sessionId } : {}),
    ...(binding.terminalRecovery ? { terminalRecovery: binding.terminalRecovery } : {}),
  };
}

function buildBalancedSplitTree(
  axis: TiledPaneSplitAxis,
  slotIds: string[],
): TiledPaneTreeNode {
  if (slotIds.length <= 1) {
    return createSlotNode(slotIds[0] ?? 'slot-1');
  }

  const leftCount = Math.max(1, Math.floor(slotIds.length / 2));
  const rightCount = Math.max(1, slotIds.length - leftCount);
  const leftIds = slotIds.slice(0, leftCount);
  const rightIds = slotIds.slice(leftCount);

  return {
    type: 'split',
    axis,
    ratio: clampSplitRatio(leftCount / (leftCount + rightCount)),
    children: [
      buildBalancedSplitTree(axis, leftIds),
      buildBalancedSplitTree(axis, rightIds),
    ],
  };
}

export function flattenTiledPaneTreeSlotIds(tree: TiledPaneTreeNode): string[] {
  if (tree.type === 'slot') {
    return [tree.slotId];
  }

  return [
    ...flattenTiledPaneTreeSlotIds(tree.children[0]),
    ...flattenTiledPaneTreeSlotIds(tree.children[1]),
  ];
}

export function createTemplatePaneTree(layout: TiledLayout): TiledPaneTreeNode {
  switch (layout) {
    case '1x1':
      return createSlotNode('slot-1');
    case '1x2':
      return {
        type: 'split',
        axis: 'vertical',
        ratio: 0.5,
        children: [createSlotNode('slot-1'), createSlotNode('slot-2')],
      };
    case '2x2':
      return {
        type: 'split',
        axis: 'horizontal',
        ratio: 0.5,
        children: [
          buildBalancedSplitTree('vertical', ['slot-1', 'slot-2']),
          buildBalancedSplitTree('vertical', ['slot-3', 'slot-4']),
        ],
      };
    case '2x4':
      return {
        type: 'split',
        axis: 'horizontal',
        ratio: 0.5,
        children: [
          buildBalancedSplitTree('vertical', ['slot-1', 'slot-2', 'slot-3', 'slot-4']),
          buildBalancedSplitTree('vertical', ['slot-5', 'slot-6', 'slot-7', 'slot-8']),
        ],
      };
    default:
      return createSlotNode('slot-1');
  }
}

export function createTemplatePaneSlotBindings(
  layout: TiledLayout,
  paneOrder: string[] = [],
): TiledPaneSlotBinding[] {
  const slotIds = flattenTiledPaneTreeSlotIds(createTemplatePaneTree(layout));
  const orderedSessionIds = uniqueIds(paneOrder);

  return slotIds.map((slotId, index) => {
    const sessionId = orderedSessionIds[index];
    return {
      slotId,
      ...(sessionId ? { sessionId } : {}),
    };
  });
}

export function createNextTiledPaneSlotId(tree: TiledPaneTreeNode): string {
  return `slot-${getMaxSlotNumber(tree) + 1}`;
}

function splitTiledPaneSlotWithId(
  tree: TiledPaneTreeNode,
  slotId: string,
  axis: TiledPaneSplitAxis,
  newSlotId: string,
): TiledPaneTreeNode | null {
  function splitNode(node: TiledPaneTreeNode): TiledPaneTreeNode | null {
    if (node.type === 'slot') {
      if (node.slotId !== slotId) {
        return null;
      }
      return {
        type: 'split',
        axis,
        ratio: 0.5,
        children: [createSlotNode(node.slotId), createSlotNode(newSlotId)],
      };
    }

    const left = splitNode(node.children[0]);
    if (left) {
      return {
        ...node,
        children: [left, node.children[1]],
      };
    }

    const right = splitNode(node.children[1]);
    if (right) {
      return {
        ...node,
        children: [node.children[0], right],
      };
    }

    return null;
  }

  return splitNode(tree);
}

export function splitTiledPaneTreeSlot(
  tree: TiledPaneTreeNode,
  slotId: string,
  axis: TiledPaneSplitAxis,
): SplitTiledPaneSlotResult | null {
  const newSlotId = createNextTiledPaneSlotId(tree);
  const nextTree = splitTiledPaneSlotWithId(tree, slotId, axis, newSlotId);
  if (!nextTree) {
    return null;
  }

  return {
    tree: nextTree,
    newSlotId,
  };
}

export function removeTiledPaneTreeSlot(
  tree: TiledPaneTreeNode,
  slotId: string,
): TiledPaneTreeNode {
  function removeNode(node: TiledPaneTreeNode): { node: TiledPaneTreeNode; removed: boolean } {
    if (node.type === 'slot') {
      return {
        node,
        removed: false,
      };
    }

    const [left, right] = node.children;
    if (left.type === 'slot' && left.slotId === slotId) {
      return {
        node: right,
        removed: true,
      };
    }
    if (right.type === 'slot' && right.slotId === slotId) {
      return {
        node: left,
        removed: true,
      };
    }

    const nextLeft = removeNode(left);
    if (nextLeft.removed) {
      return {
        node: {
          ...node,
          children: [nextLeft.node, right],
        },
        removed: true,
      };
    }

    const nextRight = removeNode(right);
    if (nextRight.removed) {
      return {
        node: {
          ...node,
          children: [left, nextRight.node],
        },
        removed: true,
      };
    }

    return {
      node,
      removed: false,
    };
  }

  if (tree.type === 'slot') {
    return tree;
  }

  return removeNode(tree).node;
}

export function updateTiledPaneTreeSplitRatio(
  tree: TiledPaneTreeNode,
  path: TiledPaneTreePath,
  ratio: number,
): TiledPaneTreeNode {
  if (path.length === 0) {
    if (tree.type !== 'split') {
      return tree;
    }
    return {
      ...tree,
      ratio: clampSplitRatio(ratio),
    };
  }

  if (tree.type !== 'split') {
    return tree;
  }

  const [index, ...rest] = path;
  if (index !== 0 && index !== 1) {
    return tree;
  }

  const nextChild = updateTiledPaneTreeSplitRatio(tree.children[index], rest, ratio);
  if (nextChild === tree.children[index]) {
    return tree;
  }

  return {
    ...tree,
    children: index === 0
      ? [nextChild, tree.children[1]]
      : [tree.children[0], nextChild],
  };
}

export function sanitizeTiledPaneTree(
  value: unknown,
): TiledPaneTreeNode | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<TiledPaneTreeNode>;
  if (candidate.type === 'slot') {
    return typeof candidate.slotId === 'string' && candidate.slotId.trim().length > 0
      ? createSlotNode(candidate.slotId.trim())
      : null;
  }

  if (candidate.type === 'split') {
    const axis = candidate.axis === 'horizontal' || candidate.axis === 'vertical'
      ? candidate.axis
      : null;
    const children = Array.isArray(candidate.children)
      ? candidate.children
      : null;
    if (!axis || !children || children.length !== 2) {
      return null;
    }

    const left = sanitizeTiledPaneTree(children[0]);
    const right = sanitizeTiledPaneTree(children[1]);
    if (!left || !right) {
      return null;
    }

    return {
      type: 'split',
      axis,
      ratio: clampSplitRatio(typeof candidate.ratio === 'number' ? candidate.ratio : 0.5),
      children: [left, right],
    };
  }

  return null;
}

export function normalizeTiledPaneSlotBindings(
  tree: TiledPaneTreeNode,
  slots: unknown,
): TiledPaneSlotBinding[] {
  const slotIds = flattenTiledPaneTreeSlotIds(tree);
  const validSlotIdSet = new Set(slotIds);
  const bindingsBySlotId = new Map<string, TiledPaneSlotBinding>();

  if (Array.isArray(slots)) {
    slots.forEach((slot) => {
      if (!slot || typeof slot !== 'object') {
        return;
      }
      const candidate = slot as Partial<TiledPaneSlotBinding>;
      const slotId = typeof candidate.slotId === 'string' ? candidate.slotId.trim() : '';
      if (!slotId || !validSlotIdSet.has(slotId) || bindingsBySlotId.has(slotId)) {
        return;
      }

      bindingsBySlotId.set(slotId, {
        slotId,
        ...(typeof candidate.sessionId === 'string' && candidate.sessionId.trim().length > 0
          ? { sessionId: candidate.sessionId.trim() }
          : {}),
        ...(candidate.terminalRecovery && typeof candidate.terminalRecovery === 'object'
          ? { terminalRecovery: candidate.terminalRecovery }
          : {}),
      });
    });
  }

  return slotIds.map((slotId) => bindingsBySlotId.get(slotId) ?? { slotId });
}

export function applyLegacyPaneOrderToBindings(
  tree: TiledPaneTreeNode,
  slots: TiledPaneSlotBinding[],
  paneOrder: string[],
): TiledPaneSlotBinding[] {
  const slotIds = flattenTiledPaneTreeSlotIds(tree);
  const nextSessionIds = uniqueIds(paneOrder);
  const existingBindings = new Map(
    normalizeTiledPaneSlotBindings(tree, slots).map((slot) => [slot.slotId, slot]),
  );

  return slotIds.map((slotId, index) => {
    const current = existingBindings.get(slotId);
    const sessionId = nextSessionIds[index];

    if (sessionId && current?.sessionId === sessionId) {
      return {
        ...current,
        slotId,
        sessionId,
      };
    }

    return {
      slotId,
      ...(sessionId ? { sessionId } : {}),
      ...(!sessionId && current?.terminalRecovery
        ? { terminalRecovery: current.terminalRecovery }
        : {}),
    };
  });
}

export function resolveLegacyPaneOrderFromTree(
  tree: TiledPaneTreeNode,
  slots: TiledPaneSlotBinding[],
): string[] {
  const slotIds = flattenTiledPaneTreeSlotIds(tree);
  const slotMap = new Map(slots.map((slot) => [slot.slotId, slot]));
  const orderedSessionIds = slotIds.flatMap((slotId) => {
    const sessionId = slotMap.get(slotId)?.sessionId?.trim();
    return sessionId ? [sessionId] : [];
  });
  return uniqueIds(orderedSessionIds);
}

export function findTiledPaneSlotPath(
  tree: TiledPaneTreeNode,
  slotId: string,
  path: TiledPaneTreePath = [],
): TiledPaneTreePath | null {
  if (tree.type === 'slot') {
    return tree.slotId === slotId ? path : null;
  }

  const left = findTiledPaneSlotPath(tree.children[0], slotId, [...path, 0]);
  if (left) {
    return left;
  }

  return findTiledPaneSlotPath(tree.children[1], slotId, [...path, 1]);
}

export function collectTiledPaneSlotRects(
  tree: TiledPaneTreeNode,
  rect: TiledPaneSlotRect = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  },
  result: Map<string, TiledPaneSlotRect> = new Map(),
): Map<string, TiledPaneSlotRect> {
  if (tree.type === 'slot') {
    result.set(tree.slotId, rect);
    return result;
  }

  const [left, right] = tree.children;
  if (tree.axis === 'vertical') {
    const leftWidth = rect.width * tree.ratio;
    const rightWidth = rect.width - leftWidth;
    collectTiledPaneSlotRects(left, {
      x: rect.x,
      y: rect.y,
      width: leftWidth,
      height: rect.height,
    }, result);
    collectTiledPaneSlotRects(right, {
      x: rect.x + leftWidth,
      y: rect.y,
      width: rightWidth,
      height: rect.height,
    }, result);
    return result;
  }

  const topHeight = rect.height * tree.ratio;
  const bottomHeight = rect.height - topHeight;
  collectTiledPaneSlotRects(left, {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: topHeight,
  }, result);
  collectTiledPaneSlotRects(right, {
    x: rect.x,
    y: rect.y + topHeight,
    width: rect.width,
    height: bottomHeight,
  }, result);
  return result;
}

function rectCenter(rect: TiledPaneSlotRect): { x: number; y: number } {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function rectOverlapLength(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

export function findAdjacentTiledPaneSlot(
  tree: TiledPaneTreeNode,
  slotId: string,
  direction: TiledPaneDirection,
): string | null {
  const rects = collectTiledPaneSlotRects(tree);
  const current = rects.get(slotId);
  if (!current) {
    return null;
  }

  const currentCenter = rectCenter(current);
  const candidates = [...rects.entries()]
    .filter(([candidateSlotId]) => candidateSlotId !== slotId)
    .map(([candidateSlotId, candidateRect]) => {
      const candidateCenter = rectCenter(candidateRect);
      let primaryDistance = Number.POSITIVE_INFINITY;
      let overlap = 0;
      let secondaryDistance = Number.POSITIVE_INFINITY;

      if (direction === 'left' && candidateRect.x + candidateRect.width <= current.x) {
        primaryDistance = current.x - (candidateRect.x + candidateRect.width);
        overlap = rectOverlapLength(
          current.y,
          current.y + current.height,
          candidateRect.y,
          candidateRect.y + candidateRect.height,
        );
        secondaryDistance = Math.abs(candidateCenter.y - currentCenter.y);
      }

      if (
        direction === 'right'
        && candidateRect.x >= current.x + current.width
      ) {
        primaryDistance = candidateRect.x - (current.x + current.width);
        overlap = rectOverlapLength(
          current.y,
          current.y + current.height,
          candidateRect.y,
          candidateRect.y + candidateRect.height,
        );
        secondaryDistance = Math.abs(candidateCenter.y - currentCenter.y);
      }

      if (direction === 'up' && candidateRect.y + candidateRect.height <= current.y) {
        primaryDistance = current.y - (candidateRect.y + candidateRect.height);
        overlap = rectOverlapLength(
          current.x,
          current.x + current.width,
          candidateRect.x,
          candidateRect.x + candidateRect.width,
        );
        secondaryDistance = Math.abs(candidateCenter.x - currentCenter.x);
      }

      if (
        direction === 'down'
        && candidateRect.y >= current.y + current.height
      ) {
        primaryDistance = candidateRect.y - (current.y + current.height);
        overlap = rectOverlapLength(
          current.x,
          current.x + current.width,
          candidateRect.x,
          candidateRect.x + candidateRect.width,
        );
        secondaryDistance = Math.abs(candidateCenter.x - currentCenter.x);
      }

      return {
        slotId: candidateSlotId,
        primaryDistance,
        overlap,
        secondaryDistance,
      };
    })
    .filter((candidate) => Number.isFinite(candidate.primaryDistance));

  if (candidates.length === 0) {
    return null;
  }

  const overlappingCandidates = candidates.filter((candidate) => candidate.overlap > 0);
  const prioritized = overlappingCandidates.length > 0 ? overlappingCandidates : candidates;
  prioritized.sort((left, right) => (
    left.primaryDistance - right.primaryDistance
    || right.overlap - left.overlap
    || left.secondaryDistance - right.secondaryDistance
    || left.slotId.localeCompare(right.slotId)
  ));

  return prioritized[0]?.slotId ?? null;
}

export function getTiledPaneSlotBinding(
  slots: TiledPaneSlotBinding[],
  slotId: string,
): TiledPaneSlotBinding | undefined {
  return slots.find((slot) => slot.slotId === slotId);
}

export function bindSessionToTiledPaneSlot(
  tree: TiledPaneTreeNode,
  slots: TiledPaneSlotBinding[],
  slotId: string,
  sessionId: string,
  terminalRecovery?: RecoverableTerminalSessionSnapshot,
): TiledPaneSlotBinding[] {
  const normalized = normalizeTiledPaneSlotBindings(tree, slots).map((slot) => {
    if (slot.sessionId !== sessionId) {
      return cloneSlotBinding(slot);
    }

    return {
      slotId: slot.slotId,
    };
  });

  return normalized.map((slot) => (
    slot.slotId === slotId
      ? {
          slotId,
          sessionId,
          ...(terminalRecovery ? { terminalRecovery } : {}),
        }
      : slot
  ));
}

export function moveOrSwapTiledPaneSlotBinding(
  tree: TiledPaneTreeNode,
  slots: TiledPaneSlotBinding[],
  sourceSlotId: string,
  targetSlotId: string,
): TiledPaneSlotBinding[] {
  const normalized = normalizeTiledPaneSlotBindings(tree, slots);
  const clonedNormalized = normalized.map(cloneSlotBinding);

  if (sourceSlotId === targetSlotId) {
    return clonedNormalized;
  }

  const source = normalized.find((slot) => slot.slotId === sourceSlotId);
  const target = normalized.find((slot) => slot.slotId === targetSlotId);

  if (!source?.sessionId || !target) {
    return clonedNormalized;
  }

  if (!target.sessionId && target.terminalRecovery) {
    return clonedNormalized;
  }

  return normalized.map((slot) => {
    if (slot.slotId === sourceSlotId) {
      return {
        slotId: sourceSlotId,
        ...(target.sessionId ? { sessionId: target.sessionId } : {}),
        ...(target.terminalRecovery ? { terminalRecovery: target.terminalRecovery } : {}),
      };
    }

    if (slot.slotId === targetSlotId) {
      return {
        slotId: targetSlotId,
        sessionId: source.sessionId,
        ...(source.terminalRecovery ? { terminalRecovery: source.terminalRecovery } : {}),
      };
    }

    return cloneSlotBinding(slot);
  });
}

export function clearTiledPaneSlotBinding(
  tree: TiledPaneTreeNode,
  slots: TiledPaneSlotBinding[],
  slotId: string,
): TiledPaneSlotBinding[] {
  return normalizeTiledPaneSlotBindings(tree, slots).map((slot) => (
    slot.slotId === slotId
      ? { slotId }
      : cloneSlotBinding(slot)
  ));
}

export function setTiledPaneSlotRecoverySnapshot(
  tree: TiledPaneTreeNode,
  slots: TiledPaneSlotBinding[],
  slotId: string,
  terminalRecovery: RecoverableTerminalSessionSnapshot | undefined,
): TiledPaneSlotBinding[] {
  return normalizeTiledPaneSlotBindings(tree, slots).map((slot) => {
    if (slot.slotId !== slotId) {
      return cloneSlotBinding(slot);
    }

    return {
      slotId,
      ...(slot.sessionId ? { sessionId: slot.sessionId } : {}),
      ...(terminalRecovery ? { terminalRecovery } : {}),
    };
  });
}

export function replaceSessionIdInTiledPaneBindings(
  tree: TiledPaneTreeNode,
  slots: TiledPaneSlotBinding[],
  fromSessionId: string,
  toSessionId: string,
): TiledPaneSlotBinding[] {
  return normalizeTiledPaneSlotBindings(tree, slots).map((slot) => (
    slot.sessionId === fromSessionId
      ? {
          slotId: slot.slotId,
          sessionId: toSessionId,
          ...(slot.terminalRecovery ? { terminalRecovery: slot.terminalRecovery } : {}),
        }
      : cloneSlotBinding(slot)
  ));
}
