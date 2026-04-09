/**
 * #759 Phase 1: Generate gap blocks between adjacent active blocks.
 *
 * Given a sorted list of completed TimeBlockData, produces gap blocks
 * to fill the spaces between adjacent active blocks, forming a
 * continuous time chain.
 */
import { normalizeTimeBlockData, type TimeBlockData } from '@/lib/types/event';

/**
 * Generate gap blocks for the spaces between adjacent active blocks.
 *
 * - Blocks without blockType are treated as 'active' (migration compat).
 * - Existing gap blocks are preserved; no duplicate gaps are created.
 * - Zero-duration gaps are allowed (to maintain chain structure).
 */
export function generateGapBlocks(blocks: TimeBlockData[]): TimeBlockData[] {
  if (blocks.length < 2) return [];

  // Sort by startTime
  const sorted = [...blocks]
    .map((block) => normalizeTimeBlockData(block))
    .sort((a, b) => a.startTime - b.startTime);

  // Filter to only active blocks (blocks without blockType default to active)
  const activeBlocks = sorted.filter(b => b.blockType !== 'gap');

  // Check if gaps already exist between any pair
  const gapSet = new Set(
    sorted
      .filter(b => b.blockType === 'gap')
      .map(b => `${b.startTime}-${b.endTime}`),
  );

  const gaps: TimeBlockData[] = [];

  for (let i = 0; i < activeBlocks.length - 1; i++) {
    const current = activeBlocks[i];
    const next = activeBlocks[i + 1];
    if (typeof current.endTime !== 'number') continue;
    const gapStart = current.endTime;
    const gapEnd = next.startTime;

    // Skip if a gap already covers this range
    if (gapSet.has(`${gapStart}-${gapEnd}`)) continue;

    gaps.push({
      id: `gap-${current.id}-${next.id}`,
      name: '',
      startId: `gap-start-${current.id}-${next.id}`,
      endId: `gap-end-${current.id}-${next.id}`,
      tags: [],
      startTime: gapStart,
      endTime: gapEnd,
      blockType: 'gap',
      transitions: [
        { type: 'start', at: gapStart },
        { type: 'end', at: gapEnd },
      ],
    });
  }

  return gaps;
}
