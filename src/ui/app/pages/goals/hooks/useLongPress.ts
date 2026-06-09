import { useMemo, useRef } from 'react';

interface UseLongPressOptions {
  delay?: number;
  moveTolerance?: number;
}

export function useLongPress(
  onLongPress: (event: PointerEvent) => void,
  options?: UseLongPressOptions,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const delay = options?.delay ?? 500;
  const moveTolerance = options?.moveTolerance ?? 10;

  return useMemo(() => ({
    onPointerDown: (event: React.PointerEvent) => {
      originRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = setTimeout(() => {
        onLongPress(event.nativeEvent);
      }, delay);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (!originRef.current || !timerRef.current) return;
      const dx = event.clientX - originRef.current.x;
      const dy = event.clientY - originRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > moveTolerance) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    onPointerUp: () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    onPointerLeave: () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
  }), [delay, moveTolerance, onLongPress]);
}
