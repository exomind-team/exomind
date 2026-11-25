import type { BetaTimeblockNode } from './timeblocks-types';

export function betaTimeblockLabel(node:BetaTimeblockNode):string{
  if(node.payload.kind==='deadline_reached'||node.payload.kind==='run_deadline_reached')return node.payload.end_mode==='hard'?'倒计时到点，行动结束待反馈':'倒计时到点，继续超时';
  const action=node.payload.action;
  switch(action.kind){case'start':return`开始时间块：${action.name}`;case'pause':return'暂停时间块';case'resume':return'继续时间块';case'rotate':return`切换时间块：${action.next.name}`;case'end_action':return'行动结束，待填写反馈';case'submit_feedback':return action.feedback.kind==='skipped'?'已明确跳过反馈':`反馈：${action.feedback.text}`;case'append_feedback':return`追加反馈到时间块 ${action.block_id.slice(0,8)}：${action.text}`;}
}
