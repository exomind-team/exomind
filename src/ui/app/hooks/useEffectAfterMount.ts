import { useEffect, useRef, type DependencyList, type EffectCallback } from 'react';

export function useEffectAfterMount(
  effect: EffectCallback,
  deps: DependencyList,
): void {
  const hasMountedRef = useRef(false);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    return effect();
    // Caller controls dependency correctness（调用方负责依赖项正确性）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
