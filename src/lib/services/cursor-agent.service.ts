/**
 * CursorAgentService
 *
 * 封装感知-行动循环（Perception-Action Loop）
 * 并将所有 cursor.* 事件写入 ExoMind EventLog
 */

import type { ICursorPort, CursorEvent, CursorStatus } from '@/environment/interfaces/cursor.port';
import type { IEventLogPort } from '@/lib/environment/interfaces/eventlog.port';
import type { EventData } from '@/lib/types/event';

interface CursorAgentServiceConfig {
  cursorPort: ICursorPort;
  eventLogPort?: IEventLogPort;
  deviceId?: string;
}

export class CursorAgentService {
  private readonly cursorPort: ICursorPort;
  private readonly eventLogPort?: IEventLogPort;
  private readonly deviceId: string;
  private unsubscribe?: () => void;

  constructor({ cursorPort, eventLogPort, deviceId }: CursorAgentServiceConfig) {
    this.cursorPort = cursorPort;
    this.eventLogPort = eventLogPort;
    this.deviceId = deviceId ?? 'cursor-agent';
  }

  startEventLogging(): void {
    this.unsubscribe = this.cursorPort.subscribe((event) => {
      void this.logEvent(event);
    });
  }

  stopEventLogging(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async perceive(): Promise<{ screenshot: Blob; status: CursorStatus }> {
    const [screenshot, status] = await Promise.all([
      this.cursorPort.screenshot(),
      this.cursorPort.getStatus(),
    ]);

    await this.logEvent({
      type: 'cursor.screenshot',
      timestamp: new Date().toISOString(),
      mode: status.mode,
      agentPos: status.agentPos,
    });

    return { screenshot, status };
  }

  async moveTo(x: number, y: number): Promise<void> {
    const result = await this.cursorPort.move({ x, y });

    await this.logEvent({
      type: 'cursor.moved',
      timestamp: new Date().toISOString(),
      x: result.x,
      y: result.y,
    });
  }

  async click(button: 'left' | 'right' = 'left'): Promise<void> {
    await this.cursorPort.click({ button, action: 'click' });

    await this.logEvent({
      type: 'cursor.clicked',
      timestamp: new Date().toISOString(),
      button,
    });
  }

  async typeText(text: string): Promise<void> {
    await this.cursorPort.type({ text });

    await this.logEvent({
      type: 'cursor.typed',
      timestamp: new Date().toISOString(),
      charCount: text.length,
    });
  }

  async sessionStart(description?: string): Promise<void> {
    await this.logEvent({
      type: 'cursor.session.start',
      timestamp: new Date().toISOString(),
      description,
    });
  }

  async sessionEnd(): Promise<void> {
    await this.logEvent({
      type: 'cursor.session.end',
      timestamp: new Date().toISOString(),
    });
  }

  private async logEvent(event: CursorEvent): Promise<void> {
    if (!this.eventLogPort) return;

    const eventData: EventData = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      content: JSON.stringify(event),
      tags: [event.type],
      metadata: {
        source: {
          deviceId: this.deviceId,
          deviceName: this.deviceId,
          platform: 'cursor',
          app: 'ExoMind',
        },
      },
    };

    await this.eventLogPort.appendEvent(eventData);
  }
}
