import { createConfigModule } from './config-factory';
import type { EventDateDisplayMode } from '@/lib/eventlog/format-event-timestamp';

const mode = createConfigModule<EventDateDisplayMode>({
  storageKey: 'exomind:eventDateDisplay',
  eventName: 'exomind:event-date-display-changed',
  defaultValue: 'compact',
  normalize: (raw) => raw === 'full' || raw === 'weekday' ? raw : 'compact',
});

export const getEventDateDisplayMode = mode.get;
export const setEventDateDisplayMode = mode.set;
export const subscribeEventDateDisplayMode = mode.subscribe;
