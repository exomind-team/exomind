import type { SummaryArtifactRecord,SummaryArtifactView,SummaryTaskView } from './summary-types';

export function summaryReason(reason:string|null):string|null{
  switch(reason){
    case null:case'':return null;
    case'owner_conflict':return'生成归属存在冲突，请明确处理归属后再继续。';
    case'missing_parents':case'trigger_incomplete':return'来源尚未齐全，请等待同步后刷新；不会据此假称完整。';
    case'configuration_changed':return'生成期间配置发生变化，请检查后手动开启新一轮。';
    case'material_unavailable':return'所选材料尚不可用，请确认原件已在本机准备好后重试。';
    case'unsupported_material':return'所选材料格式暂不能交给模型，请调整材料后再操作。';
    case'input_too_large':return'材料超过本轮输入上限，请缩小范围后再生成。';
    case'rate_limited':return'供应商限制了请求频率，请等待退避或稍后重试。';
    case'timeout':case'provider_unavailable':return'模型请求未完成，请等待重试资格或稍后手动重试。';
    case'provider_rejected':return'供应商未接受请求，请检查模型配置和授权。';
    case'invalid_output':return'模型结果未通过校验，未保存为有效回顾。';
    case'external_outcome_unknown':return'上游执行结果尚未确认；重新生成可能产生新的调用。';
    case'old_lifecycle':case'execution_interrupted':return'此前执行已中断，需要明确开启新一轮。';
    case'cancelled':return'已取消；界面不会自动恢复生成。';
    default:return'当前生成需要处理，请检查配置、来源或归属后刷新。';
  }
}
export function summaryFailure(error:unknown):string{
  const code=error&&typeof error==='object'&&'code'in error?error.code:'';
  switch(code){case'summary_conflict':return'控制状态已变化，本次操作未确认；请查证并刷新。';case'summary_forbidden':case'forbidden':case'unauthorized':return'当前授权不允许此操作，请确认档案与权限。';case'summary_blocked':return'来源或控制状态尚未满足，请处理后刷新。';case'summary_service_changed':return'本机服务已变化，请重新打开回顾后核对。';default:return'回顾操作尚未完成确认，请保留原请求并查证或重试。';}
}
type ImmutableArtifact=Pick<SummaryArtifactView,'event_id'|'profile_id'|'occurred_at_ms'|'device_id'|'author_id'|'task_id'|'run_id'|'attempt_id'|'artifact_kind'|'snapshot'|'output'|'supersedes_artifact_id'>;
/** Qualification may change; these persisted fields may not. Snapshot digest
 * is verified by Core; no frontend-only canonical encoding is invented. */
export function sameSummaryArtifact(a:ImmutableArtifact|SummaryArtifactRecord,b:ImmutableArtifact):boolean{return a.event_id===b.event_id&&a.profile_id===b.profile_id&&a.occurred_at_ms===b.occurred_at_ms&&a.device_id===b.device_id&&a.author_id===b.author_id&&a.task_id===b.task_id&&a.run_id===b.run_id&&a.attempt_id===b.attempt_id&&a.artifact_kind===b.artifact_kind&&a.supersedes_artifact_id===b.supersedes_artifact_id&&a.snapshot.digest===b.snapshot.digest&&JSON.stringify(a.output)===JSON.stringify(b.output);}
export function summaryTaskFence(task:SummaryTaskView):string{return JSON.stringify([task.owner_device_id,task.owner_generation,task.owner_control_event_id,task.control_heads,task.latest_artifact_id,task.current_run?.run_id,task.state,task.reason,task.coverage_changed]);}
