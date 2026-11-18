export type AttachmentPhase = 'queued' | 'hashing' | 'copying' | 'verifying_source' | 'reading_source' | 'staging' | 'verifying_stage';
export interface AttachmentProgress {
  phase: AttachmentPhase;
  completed: number | null;
  total: number;
  startedAt: number;
  phaseStartedAt: number;
  updatedAt: number;
}
export interface FileSourceWork {
  signal?:AbortSignal;
  cancelled(): boolean;
  progress(phase: AttachmentPhase, completed: number | null, total: number): void;
}
export const ATTACHMENT_PHASE_LABELS: Record<AttachmentPhase, string> = {
  queued: '等待准备', hashing: '校验选中文件', copying: '保存本机副本', verifying_source: '校验本机副本',
  reading_source: '读取并校验本机副本', staging: '写入附件库', verifying_stage: '校验附件库',
};
