export function resolveTimelineTitleLayout(input: {
  trackStartPx: number
  trackEndPx: number
  viewportStartPx: number
  edgeInsetPx: number
  desiredPrimarySizePx: number
}): {
  offsetPx: number
  sizePx: number
  hidden: boolean
} {
  const offsetPx = Math.max(input.trackStartPx, input.viewportStartPx) + input.edgeInsetPx
  const rightBoundaryPx = Math.min(
    input.trackEndPx - input.edgeInsetPx,
    offsetPx + Math.max(input.desiredPrimarySizePx, 0),
  )
  const sizePx = Math.max(rightBoundaryPx - offsetPx, 0)

  return {
    offsetPx,
    sizePx,
    hidden: input.trackEndPx <= input.viewportStartPx || sizePx <= 0,
  }
}
