import type { BetaReceipt } from '../client';
import type { BetaTimeblockSnapshot } from '../timeblocks-types';

export interface OverlayBinding { device_id:string; runtime_id:string; profile_id:string }
export interface OverlayScope extends OverlayBinding { ui_owner_generation:string }
export type OverlayAction =
  | {kind:'refresh'}
  | {kind:'pause'|'resume'|'end_action';block_id:string}
  | {kind:'capture_edit';draft_revision:number;text:string}
  | {kind:'capture';draft_revision:number}
  | {kind:'feedback_edit';block_id:string;draft_revision:number;text:string}
  | {kind:'submit_feedback';block_id:string;draft_revision:number;skipped:boolean}
  | {kind:'append_feedback';block_id:string;draft_revision:number}
  | {kind:'retry_capture'|'retry_timeblock';command_id:string};
export interface OverlayRequest {
  request_id:string;seq:number;overlay_generation:string;scope:OverlayScope;
  expected_revision:string;action:OverlayAction;
}
export interface OverlayTicket { ticket_id:string;request:OverlayRequest }
export interface OverlayView {
  scope:OverlayScope;
  theme:'light'|'dark';
  remote:BetaTimeblockSnapshot|null;
  clock:{text:string;warning:boolean;endTimeText?:string;stale:boolean}|null;
  capture:{text:string;revision:number;file_count:number;state:'idle'|'pending'|'failed';error:string|null};
  feedback:Record<string,{text:string;revision:number}>;
  focus_state:'idle'|'pending'|'failed';focus_error:string|null;
  focus_busy:boolean;
  focus_pending:{command_id:string;state:string;message?:string}[];
  capture_pending:{command_id:string;state:string;message?:string}[];
}
export type OverlayResponse =
  | {ok:true;view:OverlayView;receipt:BetaReceipt|null}
  | {ok:false;code:string;message:string;view:OverlayView};
export interface OverlayRead { overlay_generation:string;ready:boolean;view:OverlayView|null;responses:{request_id:string;response:OverlayResponse}[] }
export interface MainOverlayPort {
  register(binding:OverlayBinding):Promise<OverlayScope>;
  publish(scope:OverlayScope,view:OverlayView):Promise<void>;
  take(scope:OverlayScope):Promise<OverlayTicket[]>;
  validate(scope:OverlayScope,ticket_id:string):Promise<void>;
  respond(scope:OverlayScope,ticket_id:string,response:OverlayResponse):Promise<void>;
  revoke(scope:OverlayScope):Promise<void>;
}
export const overlayScopeKey=(scope:OverlayScope):string=>JSON.stringify([scope.device_id,scope.runtime_id,scope.profile_id,scope.ui_owner_generation]);
export function canonicalOverlayRequest(value:unknown):string {
  function sorted(input:unknown):unknown {
    if(Array.isArray(input))return input.map(sorted);
    if(input&&typeof input==='object')return Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,sorted(item)]));
    return input;
  }
  return JSON.stringify(sorted(value));
}
