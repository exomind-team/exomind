import type { IEventLogPort } from '../../../../src/lib/environment/interfaces/eventlog.port';
import type { EventData } from '../../../../src/lib/types/event';

/**
 * RtEventLogPort — connects the MCP server to the ExoMind Runtime's
 * EventLog HTTP endpoints instead of PouchDB / local storage.
 *
 * Endpoint mapping:
 *   GET    /eventlog               → listEvents
 *   POST   /eventlog               → appendEvent
 *   GET    /eventlog/events/:id    → getEvent
 *   DELETE /eventlog               → clearEvents
 */
export class RtEventLogPort implements IEventLogPort {
  private baseUrl: string;
  private userId: string;

  constructor(rtUrl: string, userId: string = 'anonymous') {
    this.baseUrl = rtUrl.replace(/\/+$/, '');
    this.userId = userId;
  }

  async listEvents(): Promise<EventData[]> {
    const res = await fetch(
      `${this.baseUrl}/eventlog?user_id=${encodeURIComponent(this.userId)}`,
    );
    if (!res.ok) {
      throw new Error(`Failed to list events: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async appendEvent(event: EventData): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/eventlog?user_id=${encodeURIComponent(this.userId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Failed to append event: ${res.status} ${res.statusText}`,
      );
    }
  }

  async getEvent(id: string): Promise<EventData | null> {
    const res = await fetch(
      `${this.baseUrl}/eventlog/events/${encodeURIComponent(id)}?user_id=${encodeURIComponent(this.userId)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Failed to get event: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async clearEvents(): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/eventlog?user_id=${encodeURIComponent(this.userId)}`,
      {
        method: 'DELETE',
      },
    );
    if (!res.ok) {
      throw new Error(
        `Failed to clear events: ${res.status} ${res.statusText}`,
      );
    }
  }
}
