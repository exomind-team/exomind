import { vi } from 'vitest';
import type { BetaReceipt } from '@/beta/client';
import type { BetaDeadlineEnvelope, BetaTimeblockCommand, BetaTimeblockSnapshot } from '@/beta/timeblocks-types';
import { fakeClient } from './fixtures';

export const P='11111111-1111-4111-8111-111111111111';
export const Q='22222222-2222-4222-8222-222222222222';
export const D='33333333-3333-4333-8333-333333333333';
export const R='44444444-4444-4444-8444-444444444444';
export const B='55555555-5555-4555-8555-555555555555';
export const C='66666666-6666-4666-8666-666666666666';
export const revision='a'.repeat(64);
export const status=()=>({protocol:'exomind-beta/1',device_id:D,runtime_id:R,running:true,capabilities:{timeblocks:true,typed_timeline:true}});
export function snapshot():BetaTimeblockSnapshot{return{profile_id:P,revision,heads:[],active:null,pending_feedback:[],clock:{server_now_ms:1234,epoch_changed:false,wall_clock_moved_back:false}};}
export function activeSnapshot():BetaTimeblockSnapshot{return{...snapshot(),active:{block_id:B,name:'old block',note:'',timer:{mode:'count_down',duration_ms:1000,end_mode:'hard'},phase:'running',work_ms:900,deadline_reached:false,deadline:{deadline_id:C,generation:2,owner_device_id:D,owner_generation:1,due_at_ms:1334,remaining_ms:100,end_mode:'hard',eligible:true}}};}
export const receipt=(command:BetaTimeblockCommand):BetaReceipt=>({command_id:command.command_id,event_id:command.event_id,profile_id:command.profile_id,local_seq:1,event_digest:'b'.repeat(64),durability:'local_committed',replayed:false});
export const command=():BetaTimeblockCommand=>({command_id:B,event_id:C,profile_id:P,expected_revision:revision,action:{kind:'pause',block_id:B}});
export const envelope=():BetaDeadlineEnvelope=>({runtime_id:R,device_id:D,profile_id:P,projection_revision:revision,block_id:B,deadline:activeSnapshot().active!.deadline});
export function timeblockClient(){return{...fakeClient(),status:vi.fn(async()=>status()),timeblocks:{snapshot:vi.fn(async(_profile:string)=>snapshot()),command:vi.fn(async(input:BetaTimeblockCommand)=>receipt(input)),nodes:vi.fn(async()=>({items:[],highwater:0,next_before:null})),intervals:vi.fn(async()=>({items:[],revision,next_from_ms:null,complete:true}))}};}
