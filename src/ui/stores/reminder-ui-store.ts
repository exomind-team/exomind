import { create } from 'zustand';

interface ReminderUiState {
  composeRequestToken: number;
  focusReminderId: string | null;
  requestCompose: () => void;
  requestFocus: (id: string) => void;
  clearFocus: () => void;
}

export const useReminderUiStore = create<ReminderUiState>((set) => ({
  composeRequestToken: 0,
  focusReminderId: null,
  requestCompose: () => set((state) => ({
    composeRequestToken: state.composeRequestToken + 1,
  })),
  requestFocus: (id: string) => set({
    focusReminderId: id,
  }),
  clearFocus: () => set({
    focusReminderId: null,
  }),
}));

export function requestReminderCompose(): void {
  useReminderUiStore.getState().requestCompose();
}

export function requestReminderFocus(id: string): void {
  useReminderUiStore.getState().requestFocus(id);
}
