import type {
  CreateReminderInput,
  Reminder,
  ReminderStatus,
  UpdateReminderInput,
} from '@/lib/types/reminder';

export interface IReminderPort {
  listReminders(): Promise<Reminder[]>;
  getReminderById(id: string): Promise<Reminder | null>;
  createReminder(input: CreateReminderInput): Promise<Reminder>;
  updateReminder(id: string, input: UpdateReminderInput): Promise<Reminder | null>;
  transitionReminder(id: string, to: ReminderStatus, at?: number): Promise<Reminder | null>;
  startSync(remoteUrl: string): Promise<void>;
  stopSync(): Promise<void>;
  onRemoteChange(callback: (change: unknown) => void): () => void;
}
