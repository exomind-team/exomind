import { useCallback, useState } from 'react';

interface ClientPoint {
  x: number;
  y: number;
}

export function useConnectMode() {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [previewPoint, setPreviewPoint] = useState<ClientPoint | null>(null);
  const [hoverTargetId, setHoverTargetId] = useState<string | null>(null);

  const start = useCallback((nodeId: string) => {
    setSourceId(nodeId);
    setPreviewPoint(null);
    setHoverTargetId(null);
  }, []);

  const cancel = useCallback(() => {
    setSourceId(null);
    setPreviewPoint(null);
    setHoverTargetId(null);
  }, []);

  const updatePreviewPoint = useCallback((point: ClientPoint | null) => {
    setPreviewPoint(point);
  }, []);

  const setHoverTarget = useCallback((nodeId: string | null) => {
    setHoverTargetId(nodeId);
  }, []);

  return {
    sourceId,
    isActive: sourceId !== null,
    previewPoint,
    hoverTargetId,
    start,
    cancel,
    updatePreviewPoint,
    setHoverTarget,
  };
}
