import type { BetaTimeblockClient,BetaTimeblockNode } from './timeblocks-types';
import type { SummaryClient,SummarySelection } from './summary-types';
import { validateSummarySelection } from './summary-validation';

export interface ManualBlockCandidate {blockId:string;name:string;creatorTimes:number[];hasFeedback:boolean}
export interface ManualSelectionState {candidates:ManualBlockCandidate[];nodesRead:number;nodesComplete:boolean;nextBefore:number|null;loading:boolean;error:string|null;selection:SummarySelection|null;rangeRevision:string|null;intervalNext:number|null;gapCount:number;stage:'idle'|'intervals'|'ready'}
export function manualBlockCandidates(nodes:readonly BetaTimeblockNode[]):ManualBlockCandidate[]{
  const values=new Map<string,ManualBlockCandidate>(),feedback=new Set<string>();
  for(const node of nodes){if(node.payload.kind!=='action')continue;const action=node.payload.action;if(action.kind==='submit_feedback')feedback.add(action.block_id);const block=action.kind==='start'?action:action.kind==='rotate'?action.next:null;if(!block)continue;
    const current=values.get(block.block_id);if(current)current.creatorTimes.push(node.effective_at_ms);else values.set(block.block_id,{blockId:block.block_id,name:block.name,creatorTimes:[node.effective_at_ms],hasFeedback:false});}
  return[...values.values()].map(item=>({...item,hasFeedback:feedback.has(item.blockId)}));
}
/** Node pages establish candidate completeness. Only authoritative block
 * selections establish bounds; intervals cannot exclude zero-duration blocks. */
export class ManualSummarySelection {
  private state:ManualSelectionState={candidates:[],nodesRead:0,nodesComplete:false,nextBefore:null,loading:false,error:null,selection:null,rangeRevision:null,intervalNext:null,gapCount:0,stage:'idle'};
  private nodes:BetaTimeblockNode[]=[];private highwater:number|null=null;private nodeRevision:string|null=null;private generation=0;private closed=false;
  private listeners=new Set<()=>void>();
  constructor(private readonly blocks:BetaTimeblockClient,private readonly summaries:SummaryClient,readonly profileId:string){}
  snapshot=()=>this.state;subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private emit(next:ManualSelectionState){if(this.closed)return;this.state=next;for(const listener of this.listeners)listener();}
  private live(generation:number){return!this.closed&&generation===this.generation;}
  reset():void{++this.generation;this.emit({...this.state,selection:null,intervalNext:null,rangeRevision:null,stage:'idle',loading:false,error:null,gapCount:0});}
  async loadCandidates():Promise<void>{
    if(this.closed||this.state.loading||this.state.nodesComplete)return;if(this.nodes.length>=10000){this.emit({...this.state,error:'候选节点已达到本轮 10000 项上限，范围尚未确认；请使用单块压缩。'});return;}
    const generation=this.generation;this.emit({...this.state,loading:true,error:null});
    try{if(this.highwater===null){const snapshot=await this.blocks.snapshot(this.profileId);if(!this.live(generation))return;this.nodeRevision=snapshot.revision;}
      const page=await this.blocks.nodes(this.profileId,{limit:100,...(this.highwater===null?{}:{through:this.highwater}),...(this.state.nextBefore===null?{}:{before:this.state.nextBefore})});if(!this.live(generation))return;
      if(this.highwater!==null&&page.highwater!==this.highwater||page.items.some(item=>item.profile_id!==this.profileId))throw Error('Scope');
      const existing=new Map(this.nodes.map(node=>[node.event_id,node]));for(const node of page.items){const old=existing.get(node.event_id);if(old&&JSON.stringify(old)!==JSON.stringify(node))throw Error('Changed');existing.set(node.event_id,node);}this.nodes=[...existing.values()];this.highwater=page.highwater;
      const snapshot=await this.blocks.snapshot(this.profileId);if(!this.live(generation))return;if(snapshot.revision!==this.nodeRevision)throw Error('Revision');
      this.emit({...this.state,candidates:manualBlockCandidates(this.nodes),nodesRead:this.nodes.length,nodesComplete:page.next_before===null,nextBefore:page.next_before,loading:false});
    }catch{if(this.live(generation))this.emit({...this.state,loading:false,error:'候选范围或投影已变化，不能声明读全；请关闭后重新打开压缩。'});}
  }
  private async anchor(blockId:string):Promise<SummarySelection>{const selection=validateSummarySelection(await this.summaries.blockSelection(this.profileId,blockId));if(selection.block_ids.length!==1||selection.block_ids[0]!==blockId||selection.selected_original_ids.length)throw Error('Anchor');return selection;}
  async prepare(startId:string,endId?:string):Promise<void>{
    if(this.closed||this.state.loading)return;const generation=++this.generation;this.emit({...this.state,loading:true,error:null,selection:null,intervalNext:null,stage:'idle',gapCount:0});
    try{const snapshot=await this.blocks.snapshot(this.profileId);if(!this.live(generation))return;const first=await this.anchor(startId);if(!this.live(generation))return;
      if(!endId||endId===startId){const current=await this.blocks.snapshot(this.profileId);if(!this.live(generation))return;if(current.revision!==snapshot.revision)throw Error('Revision');this.emit({...this.state,loading:false,selection:first,rangeRevision:current.revision,stage:'ready'});return;}
      if(!this.state.nodesComplete||this.nodeRevision!==snapshot.revision)throw Error('Candidates incomplete');const last=await this.anchor(endId);if(!this.live(generation))return;if(first.from_ms>=last.from_ms||first.to_ms>last.to_ms)throw Error('Ambiguous order');
      const candidates=this.state.candidates.filter(item=>item.creatorTimes.some(time=>time<=last.to_ms));if(candidates.length>100)throw Error('Candidate limit');
      const selected:SummarySelection[]=[];
      for(const candidate of candidates){if(!this.live(generation))return;if(candidate.creatorTimes.length!==1||!candidate.hasFeedback)throw Error('Unknown intermediate block');const anchor=candidate.blockId===startId?first:candidate.blockId===endId?last:await this.anchor(candidate.blockId);if(!this.live(generation))return;if(anchor.from_ms!==candidate.creatorTimes[0])throw Error('Creator changed');
        if(anchor.from_ms===first.from_ms&&candidate.blockId!==startId||anchor.from_ms===last.from_ms&&candidate.blockId!==endId||anchor.from_ms===last.to_ms&&anchor.to_ms===last.to_ms&&candidate.blockId!==endId)throw Error('Ambiguous boundary');
        if(candidate.blockId===startId||candidate.blockId===endId||anchor.from_ms<last.to_ms&&anchor.to_ms>first.from_ms||anchor.from_ms===anchor.to_ms&&anchor.from_ms>first.from_ms&&anchor.to_ms<last.to_ms)selected.push(anchor);
      }
      if(!selected.some(item=>item.block_ids[0]===startId)||!selected.some(item=>item.block_ids[0]===endId)||selected.length>100)throw Error('Incomplete boundaries');
      const ordered=selected.sort((a,b)=>a.from_ms-b.from_ms);if(ordered.some((item,index)=>index>0&&item.from_ms===ordered[index-1].from_ms))throw Error('Ambiguous order');
      const selection=validateSummarySelection({block_ids:ordered.map(item=>item.block_ids[0]),from_ms:first.from_ms,to_ms:last.to_ms,selected_original_ids:[]});
      this.emit({...this.state,selection,rangeRevision:snapshot.revision,intervalNext:selection.from_ms,stage:'intervals',loading:false});await this.continueIntervals();
    }catch{if(this.live(generation))this.emit({...this.state,selection:null,loading:false,error:'范围尚未确认：候选未读完、仍有未反馈或不可核验的中间块、同戳分界有歧义，或投影已变化。不会遗漏中间块创建请求；可继续读取或改用单块。'});}
  }
  async continueIntervals():Promise<void>{
    const selection=this.state.selection,from=this.state.intervalNext,revision=this.state.rangeRevision;if(this.closed||this.state.loading||this.state.stage!=='intervals'||!selection||from===null||!revision)return;const generation=this.generation;this.emit({...this.state,loading:true,error:null});
    try{const page=await this.blocks.intervals(this.profileId,{from_ms:from,to_ms:selection.to_ms,through:revision,limit:100});if(!this.live(generation))return;if(page.revision!==revision||page.items.some(item=>item.block_id!==null&&!selection.block_ids.includes(item.block_id)))throw Error('Unknown middle block');
      const current=await this.blocks.snapshot(this.profileId);if(!this.live(generation))return;if(current.revision!==revision)throw Error('Revision');
      this.emit({...this.state,loading:false,intervalNext:page.next_from_ms,gapCount:this.state.gapCount+page.items.filter(item=>item.kind==='gap').length,stage:page.complete?'ready':'intervals'});
    }catch{if(this.live(generation))this.emit({...this.state,loading:false,selection:null,stage:'idle',intervalNext:null,error:'区间分页或中间时间块尚未确认，未创建压缩请求；请重新核验范围。'});}
  }
  async confirmed():Promise<SummarySelection>{const current=this.state;if(current.stage!=='ready'||!current.selection||!current.rangeRevision||current.loading)throw Error('Not ready');const generation=this.generation,snapshot=await this.blocks.snapshot(this.profileId);if(!this.live(generation)||snapshot.revision!==current.rangeRevision){this.emit({...this.state,selection:null,stage:'idle',error:'确认前投影已变化，请重新核验范围。'});throw Error('Changed');}return structuredClone(current.selection);}
  dispose():void{this.closed=true;++this.generation;this.listeners.clear();}
}
