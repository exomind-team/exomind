import { useCallback, useState } from 'react';

export function useConnectMode() {
  const [sourceId, setSourceId] = useState<string | null>(null);

  const start = useCallback((nodeId: string) => {
    setSourceId(nodeId);
  }, []);

  const cancel = useCallback(() => {
    setSourceId(null);
  }, []);

  return {
    sourceId,
    isActive: sourceId !== null,
    start,
    cancel,
  };
}
