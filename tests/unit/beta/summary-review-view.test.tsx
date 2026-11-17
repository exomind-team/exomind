import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BetaReviewView } from '@/beta/BetaReviewView';
import type { SummaryArtifactView, SummarySourceSnapshot, SummaryState, SummaryTaskView } from '@/beta/summary-types';

vi.mock('@/config/llm-settings', () => { throw new Error('Pure review must not load legacy model settings'); });
vi.mock('@/beta/client', () => { throw new Error('Pure review must not own transport or model execution'); });
const P='11111111-1111-4111-8111-111111111111',T='22222222-2222-4222-8222-222222222222',D='33333333-3333-4333-8333-333333333333',E='44444444-4444-4444-8444-444444444444';
const A='55555555-5555-4555-8555-555555555555',N='66666666-6666-4666-8666-666666666666',O='77777777-7777-4777-8777-777777777777';
const now=Date.UTC(2026,10,16,12),props={now,dateMode:'compact' as const};
function task(state:SummaryState='waiting_configuration'):SummaryTaskView{return{task_id:T,profile_id:P,purpose:'first_review_v1',artifact_kind:'review',selection:snapshot().selection,created_at_ms:now-1000,trigger_key:'first-review-key',creator_event_id:E,owner_device_id:D,owner_generation:1,owner_control_event_id:E,current_run:null,state,reason:null,control_heads:[E],conflicts:[],latest_artifact_id:null,coverage_changed:false};}
function snapshot():SummarySourceSnapshot{return{selection:{block_ids:[T],from_ms:Date.UTC(2026,9,12,12),to_ms:Date.UTC(2026,9,13,12),selected_original_ids:[]},sources:[{event_id:E,kind:'capture',digest:'a'.repeat(64)}],feedback_ids:[],origin_heads:[{origin:{profile_id:P,device_id:D,restoration_epoch:N},cursor:{seq:1,hash:'b'.repeat(64)}}],through:1,input_encoded_bytes:512,materials:[{original:{original_id:O,sha256:'c'.repeat(64),byte_length:3,file_name:'synthetic.raw',media_type:'application/octet-stream'},selected:false,read_state:'not_selected'}],coverage:{page_limit:false,input_byte_limit:false,omitted_source_ids:[],read_failures:[],missing_parents:[],metadata_only:[O],unread_originals:[O],remote_visibility:'unknown'},digest:'d'.repeat(64)};}
function artifact():SummaryArtifactView{return{event_id:A,profile_id:P,occurred_at_ms:now,device_id:D,author_id:D,task_id:T,run_id:N,attempt_id:E,artifact_kind:'review',snapshot:snapshot(),output:{narrative:'A retained narrative',evidence:[E],read_original_ids:[],model:{provider:'synthetic-provider',model:'synthetic-model',role_config_digest:'e'.repeat(64),request_input_digest:'f'.repeat(64),prompt_template:'summary.review/v1',include_suggestions:false,max_output_tokens:2048,requested_model:'synthetic-requested-model'},usage:{input_tokens:0,output_tokens:null,provider_request_id:null}},supersedes_artifact_id:null,current:true,reason:null};}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('Beta review is a pure Alpha message composition',()=>{
  it('renders only the seven Core states as human-facing labels, with conflict/reason disclosed separately',()=>{
    const labels:Record<SummaryState,string>={waiting_configuration:'等待配置回顾模型',queued:'已排队',running:'正在生成回顾',retry_wait:'等待重试',succeeded:'结果待读取',failed:'回顾生成失败',cancelled:'回顾已取消'};
    const ui=render(<BetaReviewView {...props} task={task()}/>);
    for(const [state,label]of Object.entries(labels)){ui.rerender(<BetaReviewView {...props} task={{...task(state as SummaryState),reason:'synthetic-private-native-path',conflicts:[E]}}/>);expect(screen.getByText(label)).toBeInTheDocument();expect(ui.container.textContent).not.toContain(state);expect(ui.container.textContent).not.toContain('synthetic-private-native-path');expect(screen.getByText('生成归属存在冲突，需要确认后继续。')).toBeInTheDocument();}
    expect(screen.getByTestId('new-mobile-system-message-row')).toBeInTheDocument();expect(ui.container.querySelector('.bg-card')).toBeInTheDocument();expect(screen.getByText('材料尚未冻结，不能声明已读取任何记录或原件。')).toBeInTheDocument();
  });
  it('passes the displayed task to explicit Host callbacks without optimistic success or automatic calls',()=>{
    const cancel=vi.fn(),retry=vi.fn(),update=vi.fn(),configure=vi.fn();const current=task('running');
    const ui=render(<BetaReviewView {...props} task={current} actions={{cancel,retry,update,configure}}/>);
    for(const fn of[cancel,retry,update,configure])expect(fn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'取消生成'}));expect(cancel).toHaveBeenLastCalledWith(current);expect(screen.getByText('正在生成回顾')).toBeInTheDocument();expect(screen.queryByText('回顾已取消')).not.toBeInTheDocument();
    ui.rerender(<BetaReviewView {...props} task={current} actions={{cancel,retry,update,configure}} pendingAction="cancel"/>);expect(screen.getByRole('button',{name:'正在取消…'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'重试生成'}));expect(retry).not.toHaveBeenCalled();
  });
  it('keeps a displayed old artifact and its frozen evidence/coverage when a new run or latest artifact appears',()=>{
    const old=artifact();const next=snapshot();next.sources=[{event_id:N,kind:'capture',digest:'1'.repeat(64)}];next.coverage.metadata_only=[];next.coverage.unread_originals=[];
    const current:SummaryTaskView={...task('succeeded'),latest_artifact_id:N,coverage_changed:true,current_run:{run_id:N,run_generation:2,owner_generation:1,snapshot:next,attempt:null}};
    const openSource=vi.fn(),openLatest=vi.fn(),update=vi.fn();const ui=render(<BetaReviewView {...props} task={current} artifact={old} actions={{openSource,openLatest,update}}/>);
    expect(screen.getByText('A retained narrative')).toBeInTheDocument();expect(screen.getByText('原件正文未读取 1 件')).toBeInTheDocument();expect(screen.getByText('有新材料，可更新另存',{exact:true})).toBeVisible();
    fireEvent.click(screen.getByText('查看引用来源 · 1 条'));
    fireEvent.click(screen.getByRole('button',{name:`来源 1 · ${E.slice(0,8)}`}));expect(openSource).toHaveBeenLastCalledWith(old.snapshot.sources[0],P);
    fireEvent.click(screen.getByRole('button',{name:'查看新版本'}));expect(openLatest).toHaveBeenLastCalledWith(N,P);expect(screen.getByText('A retained narrative')).toBeInTheDocument();expect(ui.container.textContent).not.toContain('1'.repeat(64));
    expect(ui.container.querySelectorAll('time')).toHaveLength(3);
  });
  it('discloses page/byte/parent/read/remote gaps and never confuses available bytes with selected or model-read originals',()=>{
    const result=artifact();result.snapshot.coverage={...result.snapshot.coverage,page_limit:true,input_byte_limit:true,omitted_source_ids:[N],missing_parents:[N],read_failures:[N],remote_visibility:'known_gap'};
    result.snapshot.materials[0].read_state='verified_available';result.output.read_original_ids=[O];
    const ui=render(<BetaReviewView {...props} task={{...task('succeeded'),latest_artifact_id:A}} artifact={result}/>);
    expect(screen.getByText('达到读取页限，部分材料未纳入')).toBeInTheDocument();expect(screen.getByText('达到材料字节上限，部分记录未纳入')).toBeInTheDocument();expect(screen.getByText('缺少因果来源 1 条')).toBeInTheDocument();expect(screen.getByText('已知其他设备仍有材料待补齐')).toBeInTheDocument();
    expect(ui.container.textContent).toContain('未选择给模型');expect(ui.container.textContent).toContain('不作为模型已读内容');expect(ui.container.textContent).not.toContain('本次结果记录为模型已读');expect(screen.getByText(/输入用量：0/)).toHaveTextContent('输出用量：供应商未提供');
  });
  it('renders model text as text, denies an unknown citation, and refuses cross-profile artifacts',()=>{
    const result=artifact();result.output.narrative='保留正常叙述\n\n<img src="synthetic" onerror="synthetic()">\n\n保留后续段落';result.output.evidence=[N];const openSource=vi.fn();
    const ui=render(<BetaReviewView {...props} task={task('succeeded')} artifact={result} actions={{openSource}}/>);expect(screen.getByText('保留正常叙述')).toBeInTheDocument();expect(screen.getByText('保留后续段落')).toBeInTheDocument();expect(ui.container.querySelector('img')).toBeNull();expect(ui.container.textContent).not.toContain('onerror');expect(screen.getByText('引用来源不在此快照中')).toBeInTheDocument();expect(openSource).not.toHaveBeenCalled();
    ui.rerender(<BetaReviewView {...props} task={task('succeeded')} artifact={{...result,profile_id:N}} actions={{openSource}}/>);expect(screen.getByRole('alert')).toHaveTextContent('回顾版本与当前档案不一致');expect(screen.queryByText(result.output.narrative)).not.toBeInTheDocument();
  });
  it('shows the artifact creation date rather than its selection end, with cross-day/year disclosure and date toggling',()=>{
    const result=artifact();result.occurred_at_ms=new Date(2025,11,31,19,16).getTime();result.snapshot.selection.from_ms=new Date(2025,10,11,9,0).getTime();result.snapshot.selection.to_ms=new Date(2025,10,12,9,0).getTime();
    const current={...task('succeeded'),selection:result.snapshot.selection,created_at_ms:result.snapshot.selection.from_ms-1000,latest_artifact_id:A};
    const ui=render(<BetaReviewView now={new Date(2026,0,1,12,0).getTime()} dateMode="compact" task={current} artifact={result}/>);
    const metadata=screen.getByTestId('new-mobile-message-meta');const generated=metadata.querySelector('time');expect(generated).toHaveAttribute('datetime',new Date(result.occurred_at_ms).toISOString());expect(generated?.textContent).toMatch(/2025.*12.*31.*19:16/);
    expect(generated).not.toHaveAttribute('datetime',new Date(result.snapshot.selection.to_ms).toISOString());
    const recent={...result,occurred_at_ms:new Date(2026,0,3,19,16).getTime()};ui.rerender(<BetaReviewView now={new Date(2026,0,4,12,0).getTime()} dateMode="compact" task={current} artifact={recent}/>);
    const recentTime=screen.getByTestId('new-mobile-message-meta').querySelector('time')!;expect(recentTime.textContent).not.toContain('2026年');fireEvent.click(recentTime.closest('button')!);expect(recentTime.textContent).toContain('2026年1月3日');expect(ui.container.querySelectorAll('time')).toHaveLength(3);
  });
  it('uses the task artifact kind for a manual compression before any result exists, without inventing a generation date',()=>{
    const ui=render(<BetaReviewView {...props} task={{...task('queued'),purpose:'manual_compress_v1',artifact_kind:'compressed_block'}}/>);
    expect(screen.getByTestId('new-mobile-message-meta')).toHaveTextContent('时间块压缩');expect(screen.getByText('尚未生成时间块压缩，原始记录保留。')).toBeInTheDocument();expect(ui.container.querySelector('time')).toBeNull();
  });
  it('does not call an unread generated result absent and discloses omitted conflict diagnostics',()=>{
    const conflicts=Array.from({length:10},(_,index)=>`01234567-89ab-4def-8abc-${index.toString(16).padStart(12,'0')}`);
    const ui=render(<BetaReviewView {...props} task={{...task('succeeded'),latest_artifact_id:A,conflicts}}/>);
    expect(screen.getByText('结果正文待读取，原始记录保留。')).toBeInTheDocument();expect(ui.container.textContent).toContain('还有 2 项，未在此展开');expect(ui.container.textContent).not.toContain(conflicts[9]);
  });
});
