import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TASK_DAG_PAN_SPEED,
  DEFAULT_TASK_DAG_ZOOM_SPEED,
  getTaskDagPanSpeed,
  getTaskDagZoomSpeed,
  setTaskDagPanSpeed,
  setTaskDagZoomSpeed,
  subscribeTaskDagPanSpeedChanges,
  subscribeTaskDagZoomSpeedChanges,
} from '@/config/task-dag-keyboard-preferences';
import {
  __primeRuntimeConfigForTests,
  __resetRuntimeConfigCacheForTests,
} from '@/config/runtime-config-cache';

describe('task dag keyboard preferences（任务 DAG 键盘偏好）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetRuntimeConfigCacheForTests();
  });

  it('defaults to configured pan and zoom speeds（默认平移/缩放速度）', () => {
    expect(getTaskDagPanSpeed()).toBe(DEFAULT_TASK_DAG_PAN_SPEED);
    expect(getTaskDagZoomSpeed()).toBe(DEFAULT_TASK_DAG_ZOOM_SPEED);
  });

  it('reads runtime-backed speeds before localStorage（优先读取 Runtime 中的平移/缩放速度）', () => {
    window.localStorage.setItem('exomind:dag-pan-speed', '480');
    window.localStorage.setItem('exomind:dag-zoom-speed', '30');
    __primeRuntimeConfigForTests({
      'exomind:dag-pan-speed': '720',
      'exomind:dag-zoom-speed': '44',
    });

    expect(getTaskDagPanSpeed()).toBe(720);
    expect(getTaskDagZoomSpeed()).toBe(44);
  });

  it('persists clamped values and notifies listeners（写入归一化值并通知监听器）', () => {
    const panListener = vi.fn();
    const zoomListener = vi.fn();
    const unsubscribePan = subscribeTaskDagPanSpeedChanges(panListener);
    const unsubscribeZoom = subscribeTaskDagZoomSpeedChanges(zoomListener);

    expect(setTaskDagPanSpeed(9999)).toBe(2400);
    expect(setTaskDagZoomSpeed(2)).toBe(10);

    expect(window.localStorage.getItem('exomind:dag-pan-speed')).toBe('2400');
    expect(window.localStorage.getItem('exomind:dag-zoom-speed')).toBe('10');
    expect(panListener).toHaveBeenCalledWith(2400);
    expect(zoomListener).toHaveBeenCalledWith(10);

    unsubscribePan();
    unsubscribeZoom();
  });
});
