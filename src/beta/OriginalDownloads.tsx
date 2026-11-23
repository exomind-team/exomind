import { Tooltip } from '@/components/ui/tooltip';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BetaClient } from './client';
import { BetaApiError } from './api-error';
import { errorMessage } from './drafts';
import { betaUuid } from './initialization';
import { exportOriginalDownload, MAX_BASIC_DOWNLOAD_BYTES } from './original-download';
import type { BetaOriginal } from './original-types';
import { originalAcquisitionError, originalTransferActive, sameOriginal, type BetaOriginalSources, type BetaOriginalTransferStatus } from './original-acquisition';
import { collectOriginalDownload } from './original-download';
import { BetaImagePreview } from './BetaImagePreview';
import { BetaMediaPreview } from './BetaMediaPreview';
import { originalExportTasks } from './original-export-tasks';
import { FieldSelect } from '@/components/ui/field-select';
import { Progress } from '@/components/ui/progress';
import { useBetaDeviceNames } from './device-names';
import { BetaTextPreview } from './BetaTextPreview';
import { isTextPreviewCandidate } from './text-preview';
import { resolveMediaPreviewFormat } from './media-preview';
import { OriginalTransferDiagnostics } from './OriginalTransferDiagnostics';
import { BetaOriginalLifecyclePanel } from './BetaOriginalLifecyclePanel';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function OriginalDownloads({ client, profileId, originals, deviceId = 'local', visible = true }: { client: BetaClient; profileId: string; originals: BetaOriginal[]; deviceId?: string; visible?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState('');const [notice,setNotice]=useState('');
  const exports=originalExportTasks(client),tasks=useSyncExternalStore(exports.subscribe,exports.snapshot);
  const matches=tasks.filter(item=>item.profileId===profileId&&originals.some(original=>original.original_id===item.originalId&&original.sha256===item.sha256));
  const task=matches.find(item=>item.phase==='running')??matches[matches.length-1];
  const nativeBusy=task?.phase==='running';
  const active = useRef(true);const request=useRef<{id:string;client:BetaClient}|null>(null);
  useEffect(() => {
    active.current=true;setBusy(null);setError('');setNotice('');
    return()=>{active.current=false;request.current=null;};
  },[client,profileId]);
  async function download(original: BetaOriginal) {
    if(client.originalExports){try{exports.start(profileId,original);}catch(failure){setError(errorMessage(failure));}return;}
    if(request.current)return;
    let id:string;
    try{id=betaUuid();}catch(failure){setError(errorMessage(failure));return;}
    const owned={id,client};request.current=owned;
    setBusy(original.original_id); setError('');setNotice('');
    try {
      const result = await exportOriginalDownload(client, profileId, original,owned.id); if (!active.current||request.current!==owned) return;
      if(result.kind==='native'){
        setNotice(result.result.cancelled?result.result.partial_output?'导出已取消，所选位置可能保留未完成的新文档，请检查后清理':'导出已取消':'原件已导出并完成校验');return;
      }
      const url = URL.createObjectURL(result.blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = original.file_name;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setNotice('已准备浏览器下载，请查看下载位置');
    } catch (failure) { if (active.current&&request.current===owned) setError(errorMessage(failure)); }
    finally { if(request.current===owned){request.current=null;if(active.current)setBusy(null);} }
  }
  return <div className="mt-2 w-full max-w-sm space-y-2">{originals.map(original => <OriginalAttachment key={`${deviceId}:${profileId}:${original.original_id}:${original.sha256}`} client={client} deviceId={deviceId} visible={visible} profileId={profileId} original={original} exporting={busy!==null||nativeBusy} onDownload={()=>{void download(original);}}/>)}{busy && <p role="status" className="text-xs text-muted">正在读取并校验原件…</p>}{task&&<div className="flex items-center gap-2 text-xs text-secondary"><p role={task.phase==='failed'?'alert':'status'}>{task.message}</p>{task.phase==='running'&&<Button variant="ghost" size="sm" disabled={task.cancelPending} onClick={()=>{void exports.cancel(task.requestId);}}>取消导出</Button>}</div>}{notice&&<p role="status" className="text-xs text-muted">{notice}</p>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</div>;
}

type Lifetime={active:boolean};
function OriginalAttachment({client,deviceId,visible,profileId,original,exporting,onDownload}:{client:BetaClient;deviceId:string;visible:boolean;profileId:string;original:BetaOriginal;exporting:boolean;onDownload:()=>void}){
  const acquisition=client.originalAcquisition;
  const deviceNames=useBetaDeviceNames(deviceId);
  const [status,setStatus]=useState<BetaOriginalTransferStatus|null>(null);
  const [lifecycleRevision,setLifecycleRevision]=useState(0);
  const [statusError,setStatusError]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [sources,setSources]=useState<BetaOriginalSources|null>(null);
  const [source,setSource]=useState('');const [sourcesBusy,setSourcesBusy]=useState(false);
  const [fetching,setFetching]=useState(false);const [cancelling,setCancelling]=useState(false);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [opening,setOpening]=useState(false);const openRequest=useRef<object|null>(null);
  const life=useRef<Lifetime>({active:false});const checkSequence=useRef(0);
  const operation=useRef<{id:string;life:Lifetime}|null>(null);
  const cancelFlight=useRef<object|null>(null);
  function current(owner:Lifetime){return owner.active&&life.current===owner;}
  async function inspect(owner:Lifetime):Promise<BetaOriginalTransferStatus|null>{
    if(!acquisition)return null;const sequence=++checkSequence.current;
    try{
      const next=await acquisition.status(profileId,original.original_id);
      if(!sameOriginal(original,next.original))throw new BetaApiError('original_integrity_mismatch','原件描述与记录不一致');
      if(current(owner)&&sequence===checkSequence.current){setStatus(next);setStatusError(false);}
      return next;
    }catch(failure){if(current(owner)&&sequence===checkSequence.current){setStatusError(true);setError(originalAcquisitionError(failure));}return null;}
  }
  useEffect(()=>{
    const owner={active:true};life.current=owner;operation.current=null;cancelFlight.current=null;
    setStatus(null);setStatusError(false);setExpanded(false);setSources(null);setSource('');setSourcesBusy(false);setFetching(false);setCancelling(false);setError('');setNotice('');openRequest.current=null;setOpening(false);
    // Fetch jobs belong to the Host. Leaving this row stops observation, not
    // the durable partial transfer; explicit Cancel targets its exact UUID.
    return()=>{owner.active=false;++checkSequence.current;};
  },[client,acquisition,deviceId,profileId,original.original_id,original.sha256,original.byte_length,original.file_name,original.media_type]);
  useEffect(()=>{if(visible)void inspect(life.current);},[client,acquisition,deviceId,profileId,original.original_id,original.sha256,original.byte_length,original.file_name,original.media_type,visible]);
  useEffect(()=>{
    if(!visible||!acquisition?.observe)return;const owner=life.current;let observing=true,stop:(()=>void)|undefined;
    void acquisition.observe(profileId,original.original_id,()=>{if(observing&&current(owner)){setLifecycleRevision(value=>value+1);void inspect(owner);}}).then(unlisten=>{if(observing&&current(owner)){stop=unlisten;void inspect(owner);}else unlisten();}).catch(()=>{/* Explicit status checks remain available if the host event channel is unavailable. */});
    return()=>{observing=false;stop?.();};
  },[client,acquisition,deviceId,profileId,original.original_id,original.sha256,visible]);
  const running=fetching||!!status&&originalTransferActive(status);
  useEffect(()=>{
    if(!visible||!acquisition||!running)return;const owner=life.current;let timer:ReturnType<typeof setTimeout>|undefined;let disposed=false;
    async function tick(){await inspect(owner);if(!disposed&&current(owner))timer=setTimeout(()=>{void tick();},1000);}
    timer=setTimeout(()=>{void tick();},250);
    return()=>{disposed=true;clearTimeout(timer);};
  },[acquisition,running,profileId,original.original_id,original.sha256,visible]);
  async function chooseSource(){
    if(!acquisition||sourcesBusy)return;const owner=life.current;setExpanded(true);setSourcesBusy(true);setError('');setNotice('');
    try{const next=await acquisition.sources(profileId);if(current(owner)){setSources(next);setSource(previous=>next.devices.includes(previous)?previous:next.devices[0]??'');}}
    catch(failure){if(current(owner))setError(originalAcquisitionError(failure));}
    finally{if(current(owner))setSourcesBusy(false);}
  }
  async function fetchOriginal(){
    if(!acquisition||operation.current||running||!source||!sources?.network_enabled)return;
    const owner=life.current;let id:string;
    try{id=betaUuid();}catch(failure){setError(errorMessage(failure));return;}
    const request={id,life:owner};operation.current=request;cancelFlight.current=null;setFetching(true);setCancelling(false);setError('');setNotice('');
    try{
      const result=await acquisition.fetch(profileId,original.original_id,source,id);
      if(!current(owner)||operation.current!==request)return;
      if(!sameOriginal(result.original,original))throw new BetaApiError('original_integrity_mismatch','原件描述与记录不一致');
      const latest=await inspect(owner);
      if(current(owner)&&operation.current===request)setNotice(result.verified&&latest?.availability==='complete'?'已获取并校验原件':'本次获取已结束，原件仍未完成；已收到的部分会保留');
    }catch(failure){if(current(owner)&&operation.current===request){setError(originalAcquisitionError(failure));await inspect(owner);}}
    finally{if(current(owner)&&operation.current===request){operation.current=null;setFetching(false);setCancelling(false);}}
  }
  async function findOriginal(openAfter=false){
    if(!acquisition?.fetchAny){await chooseSource();return;}
    if(operation.current||running)return;const owner=life.current,id=betaUuid(),request={id,life:owner};
    operation.current=request;cancelFlight.current=null;setFetching(true);setCancelling(false);setError('');setNotice('正在查找持有完整原件的已授权设备…');
    try{
      const result=await acquisition.fetchAny(profileId,original.original_id,id,attempt=>{if(current(owner)&&operation.current===request)setNotice(`正在检查 ${deviceNames.label(attempt.deviceId)}（${attempt.index}/${attempt.total}）`);});
      if(!current(owner)||operation.current!==request)return;
      if(!sameOriginal(result.original,original))throw new BetaApiError('original_integrity_mismatch','原件描述与记录不一致');
      const latest=await inspect(owner);if(!current(owner)||operation.current!==request)return;
      if(!result.verified||latest?.availability!=='complete')throw new BetaApiError('original_not_ready','原件尚未完整校验');
      setNotice('已获取并校验原件');
      if(openAfter&&client.originalOpener){setOpening(true);await client.originalOpener.open(profileId,original.original_id,betaUuid());if(current(owner)&&operation.current===request)setNotice('已交给系统打开');}
    }catch(failure){if(current(owner)&&operation.current===request){setError(originalAcquisitionError(failure));await inspect(owner);}}
    finally{if(current(owner)&&operation.current===request){operation.current=null;setFetching(false);setCancelling(false);setOpening(false);}}
  }
  async function cancelFetch(){
    const requestId=operation.current?.id??status?.request_id;if(!acquisition||!requestId||cancelFlight.current)return;
    const owner=life.current;const flight={};cancelFlight.current=flight;setCancelling(true);setError('');
    try{const accepted=await acquisition.cancel(profileId,original.original_id,requestId);if(current(owner)&&cancelFlight.current===flight){setNotice(accepted?'正在取消获取；已收到的部分会保留':'本次获取已结束或进入确认阶段，正在检查状态');await inspect(owner);}}
    catch(failure){if(current(owner)&&cancelFlight.current===flight)setError(originalAcquisitionError(failure));}
    finally{if(current(owner)&&cancelFlight.current===flight){cancelFlight.current=null;setCancelling(false);}}
  }
  const readable=!acquisition||!!status&&!statusError&&status.availability==='complete'&&!running;
  async function openOriginal(){
    if(!client.originalOpener||!readable||openRequest.current)return;
    const owner=life.current,request={};openRequest.current=request;setOpening(true);setError('');setNotice('');
    try{await client.originalOpener.open(profileId,original.original_id,betaUuid());if(current(owner)&&openRequest.current===request)setNotice('已交给系统打开');}
    catch(failure){if(current(owner)&&openRequest.current===request)setError(errorMessage(failure));}
    finally{if(current(owner)&&openRequest.current===request){openRequest.current=null;setOpening(false);}}
  }
  const label=statusError?'本机原件状态待重新确认':!status?'正在检查本机原件…':status.availability==='complete'?'本机原件已完整校验':status.availability==='hash_mismatch'?'原件校验失败，尚不可用':status.availability==='missing'?'本机缺少原件，仅有记录信息':`已收到 ${formatBytes(status.next_offset)} / ${formatBytes(status.byte_length)}，尚未完整校验`;
  const transferLabel=status?.transfer_state==='verifying'?'正在校验原件…':status?.transfer_state==='confirming'?'本机已校验，正在确认传输…':'正在获取原件…';
  const statusFailure=!running&&status?.last_error_code?originalAcquisitionError(status.last_error_code):'';
  const mediaFormat = resolveMediaPreviewFormat(original.file_name, original.media_type);
  const canDownloadOriginal = !!client.originalExports || original.byte_length <= MAX_BASIC_DOWNLOAD_BYTES;
  const fallbackActionMessage = client.originalOpener
    ? canDownloadOriginal
      ? '关闭后可使用系统打开或下载原件'
      : '关闭后可使用系统打开原件'
    : canDownloadOriginal
      ? '关闭后可下载原件'
      : '当前环境没有可用的系统打开或网页下载入口';
  const diagnostics = (client.originalAcquisition||client.originalAutoDiagnostics)
    ? <OriginalTransferDiagnostics client={client} profileId={profileId} original={original} visible={visible} />
    : null;
  return <div className="space-y-2 rounded-2xl border border-border-page bg-surface px-3 py-2">
    {readable && <BetaImagePreview identity={`${deviceId}:${profileId}:${original.original_id}:${original.sha256}`} sourceScope={client} visible={visible} inline fileName={original.file_name} mediaType={original.media_type} byteLength={original.byte_length} load={() => collectOriginalDownload(client, profileId, original)} />}
    <div className="flex items-center gap-2"><Tooltip content={client.originalOpener?readable?'使用系统打开':'自动获取原件后用系统打开':'系统打开需要独立应用；仍可下载原件'}><Button size="icon" variant="ghost" className="shrink-0" aria-label={`打开 ${original.file_name}`}  disabled={!client.originalOpener||!readable&&!acquisition?.fetchAny||opening||running} onClick={()=>{void(readable?openOriginal():findOriginal(true));}}><FileText size={16} className="text-brand-accent" aria-hidden="true" /></Button></Tooltip>
      {readable&&isTextPreviewCandidate(original.file_name,original.media_type)&&<BetaTextPreview identity={JSON.stringify([deviceId,profileId,original.original_id,original.sha256,original.byte_length])} sourceScope={client} visible={visible} fileName={original.file_name} mediaType={original.media_type} byteLength={original.byte_length} load={()=>collectOriginalDownload(client,profileId,original)}/>}
      <div className="min-w-0 flex-1"><p className="break-all text-xs font-medium">{original.file_name}</p><p className="text-[10px] text-muted">{formatBytes(original.byte_length)}</p></div>
      <Button variant="ghost" size="icon" aria-label={`下载 ${original.file_name}`} disabled={exporting||!readable||!client.originalExports&&original.byte_length>MAX_BASIC_DOWNLOAD_BYTES} onClick={onDownload}><Download size={14}/></Button>
    </div>
    {readable && mediaFormat?.kind === 'audio' && <BetaMediaPreview
      identity={JSON.stringify([deviceId, profileId, original.original_id, original.sha256, original.byte_length, original.file_name, original.media_type])}
      sourceScope={client}
      visible={visible}
      inline
      fileName={original.file_name}
      mediaType={original.media_type}
      byteLength={original.byte_length}
      fallbackActionMessage={fallbackActionMessage}
      load={() => collectOriginalDownload(client, profileId, original)}
    />}
    <BetaOriginalLifecyclePanel profileId={profileId} originalId={original.original_id} fileName={original.file_name} deviceLabel={deviceNames.label} visible={visible} revision={lifecycleRevision} />
    {opening&&<p role="status" className="text-xs text-muted">正在准备系统打开…</p>}
    {acquisition&&<div className="mt-1 space-y-1 text-xs text-muted"><p role="status">{label}</p>
      {running&&<><p role="status">{transferLabel}</p>{status&&<Progress className="h-1 w-full" aria-label={`原件获取进度 ${original.file_name}`} value={status.next_offset} max={Math.max(1,status.byte_length)}/>}</>}
      <div className="flex flex-wrap items-center gap-1">
        {running?<Button variant="ghost" size="sm" disabled={cancelling} onClick={()=>{void cancelFetch();}}>{cancelling?'正在取消…':'取消获取'}</Button>:<>
          {status?.availability!=='complete'&&<><Button variant="outline" size="sm" disabled={sourcesBusy||exporting} onClick={()=>{void findOriginal();}}>{sourcesBusy?'正在查找授权来源…':'获取原件'}</Button>{acquisition.fetchAny&&<Button variant="ghost" size="sm" onClick={()=>{void chooseSource();}}>选择来源…</Button>}</>}
          <Button variant="ghost" size="sm" aria-label={`检查原件 ${original.file_name}`} onClick={()=>{setError('');void inspect(life.current);}}><RefreshCw size={12} className="mr-1"/>检查状态</Button></>}
        {diagnostics}
      </div>
      {expanded&&!running&&<div className="space-y-2">{sources&&!sources.network_enabled&&<p>设备同步已关闭，请先在设备页开启</p>}{sources?.network_enabled&&!sources.devices.length&&<p>尚无已授权的来源设备，请先在设备页完成加入确认</p>}
        {!!sources?.devices.length&&<><label className="block space-y-1"><span>原件来源</span><FieldSelect label={`原件来源 ${original.file_name}`} className="w-full" value={source} disabled={!sources.network_enabled} onValueChange={setSource} options={sources.devices.map(id=>({value:id,label:deviceNames.label(id)}))}/></label>
          <p>来源设备需在线并持有此原件；只获取已授权内容</p><Button variant="outline" size="sm" disabled={!source||!sources.network_enabled||exporting} onClick={()=>{void fetchOriginal();}}>开始获取</Button></>}
      </div>}
    </div>}
    {!acquisition&&diagnostics&&<div className="flex flex-wrap items-center gap-1">{diagnostics}</div>}
    {(error||statusFailure)&&<p role="alert" className="text-xs text-destructive">{error||statusFailure}</p>}{notice&&<p role="status" className="text-xs text-secondary">{notice}</p>}
    {!client.originalExports&&original.byte_length>MAX_BASIC_DOWNLOAD_BYTES&&<p className="text-xs text-muted">网页下载支持 64 MiB 以内；更大原件请在独立应用中导出</p>}
  </div>;
}
