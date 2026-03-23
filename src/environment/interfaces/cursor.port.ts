/**
 * Cursor Port — AI Agent 桌面控制接口
 *
 * 作为感知行为节点，使 ExoMind Agent 能感知屏幕状态并控制鼠标键盘
 */

export interface CursorStatus {
  mode: 'visual' | 'full_control';
  screen: { x: number; y: number; w: number; h: number };
  agentPos?: { x: number; y: number };
}

export interface CursorMoveParams {
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  agentId?: number;
}

export interface CursorClickParams {
  button?: 'left' | 'right';
  action?: 'click' | 'down' | 'up';
  agentId?: number;
}

export interface CursorTypeParams {
  text?: string;
  key?: string;
  agentId?: number;
}

export interface CursorScrollParams {
  delta: number;
  agentId?: number;
}

export interface CursorEvent {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * ICursorPort
 * 感知层：screenshot / getStatus
 * 行动层：move / click / type / scroll / setMode
 * 事件流：subscribe（SSE）
 */
export interface ICursorPort {
  screenshot(): Promise<Blob>;
  getStatus(): Promise<CursorStatus>;
  move(params: CursorMoveParams): Promise<{ x: number; y: number }>;
  click(params: CursorClickParams): Promise<void>;
  type(params: CursorTypeParams): Promise<void>;
  scroll(params: CursorScrollParams): Promise<void>;
  setMode(mode: 'full_control' | 'visual'): Promise<void>;
  subscribe(onEvent: (event: CursorEvent) => void): () => void;
  isAvailable(): Promise<boolean>;
}
