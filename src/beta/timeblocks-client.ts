import { BetaApiError } from './api-error';
import { validateReceipt } from './client';
import type { BetaQuery, BetaStatus } from './client';
import type { BetaTimeblockClient, BetaTimeblockIO, BetaTimelinePage, BetaTimelinePeriodQuery } from './timeblocks-types';
import { validateDeadlineEnvelope, validateEventQuery, validateIntervalPage, validateIntervalQuery, validateNodePage, validateTimeblockCommand, validateTimeblockSnapshot, validateTimelinePage } from './timeblocks-validation';

type NativeInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Feature = 'timeblocks' | 'typed_timeline' | 'timeline_period';
function capability(status: BetaStatus, feature: Feature): void {
  if (status.capabilities?.[feature] !== true) {
    const code = feature === 'timeblocks' ? 'unsupported_timeblocks' : feature === 'timeline_period' ? 'unsupported_timeline_period' : 'unsupported_timeline';
    const message = feature === 'timeline_period' ? '当前服务尚不支持日／周／月范围浏览，请更新 Beta 服务' : '当前服务尚未提供此时间块能力，请更新服务后重试';
    throw new BetaApiError(code, message);
  }
  const id=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (!status.runtime_id || !id.test(status.runtime_id) || !id.test(status.device_id)) throw new BetaApiError('invalid_service_identity', '服务缺少有效实例身份，尚未读取时间块');
}
async function stableRead<T>(identity: () => Promise<BetaStatus>, feature: Feature, read: () => Promise<unknown>, parse: (value: unknown, identity: BetaStatus) => T): Promise<T> {
  const before = await identity(); capability(before, feature);
  const raw = await read(); const after = await identity();
  if (before.runtime_id !== after.runtime_id || before.device_id !== after.device_id) throw new BetaApiError('runtime_changed', '服务已重启，旧读取结果未应用，请刷新');
  return parse(raw, before);
}
function eventParameters(query: BetaQuery): string {
  validateEventQuery(query); const params = new URLSearchParams();
  for (const key of ['before','through','limit'] as const) if (query[key] !== undefined) params.set(key, String(query[key]));
  if (query.search !== undefined) params.set('q', query.search); return params.toString();
}
function periodParameters(query: BetaTimelinePeriodQuery): string {
  if (!Number.isSafeInteger(query.from_ms) || !Number.isSafeInteger(query.to_ms) || query.to_ms <= query.from_ms) {
    throw new BetaApiError('invalid_timeline_period_query', '时间范围无效');
  }
  validateEventQuery(query);
  if (query.tag !== undefined && (typeof query.tag !== 'string' || !query.tag.trim() || new TextEncoder().encode(query.tag).byteLength > 128)) {
    throw new BetaApiError('invalid_timeline_period_query', '标签筛选无效');
  }
  const params = new URLSearchParams({ from_ms: String(query.from_ms), to_ms: String(query.to_ms) });
  for (const key of ['before','through','limit'] as const) if (query[key] !== undefined) params.set(key, String(query[key]));
  if (query.search !== undefined) params.set('q', query.search);
  if (query.tag !== undefined) params.set('tag', query.tag);
  return params.toString();
}

export function nativeTimeblockFeatures(call: NativeInvoke, identity: () => Promise<BetaStatus>): {
  timeblocks: BetaTimeblockClient;
  timelinePage(profileId: string, query: BetaQuery): Promise<BetaTimelinePage>;
  timelinePeriodPage(profileId: string, query: BetaTimelinePeriodQuery): Promise<BetaTimelinePage>;
} {
  const timeblocks: BetaTimeblockClient = {
    snapshot(profileId) { return stableRead(identity, 'timeblocks', () => call('beta_timeblock_snapshot', {profileId}), (raw,status) => validateTimeblockSnapshot(raw,profileId,status.device_id)); },
    async command(command) {
      const input=validateTimeblockCommand(command); capability(await identity(),'timeblocks');
      return validateReceipt(await call('beta_timeblock_command',{command:input}), input);
    },
    nodes(profileId,query) { validateEventQuery(query); return stableRead(identity,'timeblocks',()=>call('beta_timeblock_nodes',{profileId,query}),raw=>validateNodePage(raw,profileId,query)); },
    intervals(profileId,query) { validateIntervalQuery(query); return stableRead(identity,'timeblocks',()=>call('beta_timeblock_intervals',{profileId,query}),raw=>validateIntervalPage(raw,query)); },
    deadlineEnvelope(profileId,snapshot) {
      return stableRead(identity,'timeblocks',()=>call('beta_deadline_envelope',{profileId}),(raw,status)=>{
        if(snapshot.profile_id!==profileId)throw new BetaApiError('stale_deadline','到点提示档案不一致');
        return validateDeadlineEnvelope(raw,{status,snapshot});
      });
    },
  };
  return {
    timeblocks,
    timelinePage(profileId,query){validateEventQuery(query);return stableRead(identity,'typed_timeline',()=>call('beta_timeline_page',{profileId,query}),raw=>validateTimelinePage(raw,profileId,query));},
    timelinePeriodPage(profileId,query){periodParameters(query);return stableRead(identity,'timeline_period',()=>call('beta_timeline_period_page',{profileId,query}),raw=>validateTimelinePage(raw,profileId,query));},
  };
}

export function webTimeblockFeatures(io: BetaTimeblockIO): {
  timeblocks: BetaTimeblockClient;
  timelinePage(profileId: string, query: BetaQuery): Promise<BetaTimelinePage>;
  timelinePeriodPage(profileId: string, query: BetaTimelinePeriodQuery): Promise<BetaTimelinePage>;
} {
  const base=(profileId:string)=>`/profiles/${encodeURIComponent(profileId)}`;
  return {
    timeblocks: {
      snapshot(profileId) {return stableRead(io.identity,'timeblocks',()=>io.json(profileId,`${base(profileId)}/timeblocks/current`,'GET'),(raw,status)=>validateTimeblockSnapshot(raw,profileId,status.device_id));},
      async command(command) {
        const input=validateTimeblockCommand(command);capability(await io.identity(),'timeblocks');
        const {profile_id,...body}=input;
        return validateReceipt(await io.json(profile_id,`${base(profile_id)}/timeblocks/commands`,'POST',body),input);
      },
      nodes(profileId,query) {const params=eventParameters(query);return stableRead(io.identity,'timeblocks',()=>io.json(profileId,`${base(profileId)}/timeblocks/nodes?${params}`,'GET'),raw=>validateNodePage(raw,profileId,query));},
      intervals(profileId,query) {
        validateIntervalQuery(query);const params=new URLSearchParams({from_ms:String(query.from_ms),to_ms:String(query.to_ms)});
        if(query.limit!==undefined)params.set('limit',String(query.limit));if(query.through!==undefined)params.set('through',query.through);
        return stableRead(io.identity,'timeblocks',()=>io.json(profileId,`${base(profileId)}/timeblocks/intervals?${params}`,'GET'),raw=>validateIntervalPage(raw,query));
      },
    },
    timelinePage(profileId,query) {const params=eventParameters(query);return stableRead(io.identity,'typed_timeline',()=>io.json(profileId,`${base(profileId)}/timeline?${params}`,'GET'),raw=>validateTimelinePage(raw,profileId,query));},
    timelinePeriodPage(profileId,query) {const params=periodParameters(query);return stableRead(io.identity,'timeline_period',()=>io.json(profileId,`${base(profileId)}/timeline/period?${params}`,'GET'),raw=>validateTimelinePage(raw,profileId,query));},
  };
}
