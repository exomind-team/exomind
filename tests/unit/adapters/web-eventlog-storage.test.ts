import { describe, expect, it } from "vitest";
import type { EventData } from "@/lib/types/event";
import {
  applyEventLogListOptions,
  resolveEventLogListSemantics,
} from "@/lib/adapters/web-eventlog-storage";

const sampleEvents: EventData[] = [
  {
    id: "evt-newest",
    timestamp: 2_000,
    content: "newest",
    tags: ["note"],
  },
  {
    id: "evt-cursor",
    timestamp: 1_500,
    content: "cursor",
    tags: ["note"],
  },
  {
    id: "evt-late-old",
    timestamp: 500,
    content: "late-old",
    tags: ["note"],
  },
];

describe("applyEventLogListOptions", () => {
  it("keeps full results when legacy adapters receive incremental cursor options（legacy 增量参数回退为全量结果）", () => {
    expect(
      applyEventLogListOptions(sampleEvents, {
        sinceId: "evt-cursor",
        sinceTimestamp: 1_500,
      }),
    ).toEqual(sampleEvents);
  });

  it("still applies limit when only limit is provided（仅 limit 时仍保留截断能力）", () => {
    expect(
      applyEventLogListOptions(sampleEvents, {
        limit: 2,
      }),
    ).toEqual(sampleEvents.slice(0, 2));
  });

  it("filters by explicit time range when untilTimestamp is provided（显式时间范围查询应按区间过滤）", () => {
    expect(
      applyEventLogListOptions(sampleEvents, {
        sinceTimestamp: 1_000,
        untilTimestamp: 1_800,
      }),
    ).toEqual([sampleEvents[1]]);
  });

  it("marks legacy cursor queries as full snapshot semantics（legacy cursor 查询应显式标记为全量快照）", () => {
    expect(
      resolveEventLogListSemantics({
        sinceId: "evt-cursor",
        sinceTimestamp: 1_500,
      }),
    ).toBe("full_snapshot");
  });
});
