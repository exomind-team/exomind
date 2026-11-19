import React from 'react';
import { createRoot } from 'react-dom/client';
import { sha256 } from '@noble/hashes/sha2.js';
import { BetaApp } from '../../../src/beta/BetaApp';
import type { BetaClient, BetaCommand, BetaEvent, BetaReceipt } from '../../../src/beta/client';
import type { BetaOriginal, BetaStage } from '../../../src/beta/original-types';
import type { BetaActiveBlock, BetaTimeblockNode, BetaTimeblockSnapshot } from '../../../src/beta/timeblocks-types';
import '../../../src/index.css';
import '../../../src/beta/beta-ui.css';

document.documentElement.classList.add('beta-ui');

// Full production UI with an explicitly synthetic, browser-local adapter.
// No native IPC, real archive, network peer, credential or model is used.
const P = '11111111-1111-4111-8111-111111111111';
const Q = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const counters = { snapshots: 0, timeline: 0, imageReads: 0, textReads: 0, captures: 0, timerCommands: 0 };
const digest = (bytes: Uint8Array) => Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
const originals = new Map<string, Uint8Array>();
let textOriginalId = '';
const stages = new Map<string, { stage: BetaStage; bytes: Uint8Array }>();
const receipts = new Map<string, BetaReceipt>();
const profiles = [{ profile_id: P, display_name: '日常 · 合成档案' }, { profile_id: Q, display_name: '另一份 · 合成档案' }];
const events: BetaEvent[] = [];
const nodes: BetaTimeblockNode[] = [];
let active: BetaActiveBlock | null = null;
let timerRevision = 0;
const pending = new Set<string>();
const names = ['灵感随手记下，稍后再整理。', '读到这里时，保留位置，继续思考。', '今天想把记录和专注连起来。'];
for (let index = 1; index <= 48; index++) events.push({ event_id: crypto.randomUUID(), profile_id: P, device_id: D, author_id: D, author_kind: 'human', occurred_at_ms: Date.now() - (49 - index) * 600000, text: `${names[index % names.length]}\n第 ${index} 条合成记录`, tags: [], digest: String(index).padStart(64, '0'), local_seq: index });

async function picture(): Promise<BetaOriginal> {
  const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 320;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#f6eee7'; context.fillRect(0, 0, 720, 320);
  context.fillStyle = '#362d28'; context.font = 'bold 34px sans-serif'; context.fillText('把此刻，留给下一刻', 36, 62);
  context.font = '18px sans-serif'; context.fillStyle = '#78685d'; context.fillText('本机图片 · 合成验收素材', 36, 100);
  ['记录', '专注', '回顾'].forEach((label, index) => {
    const x = 36 + index * 226;
    context.fillStyle = index === 1 ? '#c75b3a' : '#e5d7ca'; context.beginPath(); context.roundRect(x, 154, 196, 112, 18); context.fill();
    context.fillStyle = index === 1 ? '#ffffff' : '#46382f'; context.font = 'bold 26px sans-serif'; context.fillText(label, x + 70, 222);
  });
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer()), id = crypto.randomUUID(); originals.set(`${P}:${id}`, bytes);
  return { original_id: id, sha256: digest(bytes), byte_length: bytes.length, file_name: '把此刻留给下一刻.png', media_type: 'image/png' };
}
function receipt(command: Pick<BetaCommand, 'command_id' | 'event_id' | 'profile_id'>): BetaReceipt {
  const old = receipts.get(command.command_id); if (old) return { ...old, replayed: true };
  const result: BetaReceipt = { command_id: command.command_id, event_id: command.event_id, profile_id: command.profile_id, local_seq: events.length + nodes.length + 1, event_digest: 'a'.repeat(64), durability: 'local_committed', replayed: false };
  receipts.set(command.command_id, result); return result;
}
function snapshot(profileId: string): BetaTimeblockSnapshot {
  return { profile_id: profileId, revision: String(timerRevision).padStart(64, '0'), heads: nodes.filter(node => node.profile_id === profileId).slice(-1).map(node => node.event_id), active: profileId === P ? active : null, pending_feedback: profileId === P ? [...pending] : [], clock: { server_now_ms: Date.now(), epoch_changed: false, wall_clock_moved_back: false } };
}
const client: BetaClient = {
  status: async () => ({ protocol: 'exomind-beta/1', device_id: D, runtime_id: '44444444-4444-4444-8444-444444444444', running: true, capabilities: { originals: true, timeblocks: true, typed_timeline: true } }),
  profiles: async () => profiles,
  provisionProfile: async (profile_id, display_name) => { const profile = { profile_id, display_name }; profiles.push(profile); return profile; },
  capture: async command => {
    counters.captures++; const saved = receipt(command);
    if (!saved.replayed) events.push({ ...command, device_id: D, author_id: D, author_kind: 'human', digest: saved.event_digest, local_seq: saved.local_seq });
    return saved;
  },
  receipt: async (_profile, id) => receipts.get(id) ?? null,
  eventsPage: async (profile, query) => ({ items: events.filter(event => event.profile_id === profile && (!query.search || event.text.includes(query.search))).sort((a,b) => b.local_seq-a.local_seq), highwater: events.length + nodes.length, next_before: null }),
  timelinePage: async (profile, query) => {
    counters.timeline++;
    const captures = events.filter(event => event.profile_id === profile && (!query.search || event.text.includes(query.search))).map(record => ({ kind: 'capture' as const, record }));
    const timers = query.search ? [] : nodes.filter(node => node.profile_id === profile).map(record => ({ kind: 'timeblock' as const, record }));
    return { items: [...captures, ...timers].sort((a,b) => b.record.local_seq-a.record.local_seq), highwater: events.length + nodes.length, next_before: null };
  },
  timeblocks: {
    snapshot: async profile => { counters.snapshots++; return structuredClone(snapshot(profile)); },
    command: async command => {
      counters.timerCommands++; const saved = receipt(command); if (saved.replayed) return saved;
      const action = command.action;
      if (action.kind === 'start') active = { block_id: action.block_id, name: action.name, note: action.note, timer: action.timer, phase: 'running', work_ms: 0, deadline_reached: false, deadline: null };
      if (action.kind === 'rotate') active = { ...action.next, phase: 'running', work_ms: 0, deadline_reached: false, deadline: null };
      if (action.kind === 'pause' && active) active.phase = 'paused';
      if (action.kind === 'resume' && active) active.phase = 'running';
      if (action.kind === 'end_action' && active) { active.phase = 'feedback_pending'; pending.add(active.block_id); }
      if (action.kind === 'submit_feedback') { pending.delete(action.block_id); active = null; }
      timerRevision++;
      nodes.push({ event_id: command.event_id, profile_id: command.profile_id, device_id: D, source: { kind: 'human', author_id: D, owner_generation: null }, parents: snapshot(command.profile_id).heads, occurred_at_ms: Date.now(), effective_at_ms: Date.now(), clock: { epoch_id: '55555555-5555-4555-8555-555555555555', elapsed_ms: timerRevision }, payload: { kind: 'action', action }, digest: saved.event_digest, local_seq: saved.local_seq });
      return saved;
    },
    nodes: async profile => ({ items: nodes.filter(node => node.profile_id === profile), highwater: nodes.length, next_before: null }),
    intervals: async profile => ({ items: [], revision: snapshot(profile).revision, next_from_ms: null, complete: true }),
  },
  originals: {
    begin: async input => {
      const stage: BetaStage = { stage_id: input.stage_id, profile_id: input.profile_id, original: { original_id: input.original_id, sha256: input.expected_sha256, byte_length: input.byte_length, file_name: input.file_name, media_type: input.media_type }, state: 'uploading', next_offset: 0, generation: 1 };
      stages.set(stage.stage_id, { stage, bytes: new Uint8Array(input.byte_length) }); return structuredClone(stage);
    },
    status: async (_profile, id) => structuredClone(stages.get(id)!.stage),
    write: async (_profile, id, offset, bytes) => { const current = stages.get(id)!; current.bytes.set(bytes, offset); current.stage.next_offset = offset + bytes.length; return structuredClone(current.stage); },
    verify: async (profile, id) => { const current = stages.get(id)!; current.stage.state = digest(current.bytes) === current.stage.original.sha256 ? 'verified' : 'hash_mismatch'; originals.set(`${profile}:${current.stage.original.original_id}`, current.bytes); return structuredClone(current.stage); },
    readStage: async (_profile, id, offset, length) => stages.get(id)!.bytes.slice(offset, offset + length),
    readOriginal: async (profile, id, offset, length) => { if(id===textOriginalId)counters.textReads++;else counters.imageReads++; const bytes = originals.get(`${profile}:${id}`); if (!bytes) throw new Error('本机没有该合成原件'); return bytes.slice(offset, offset + length); },
  },
};
const journal = { read: async (key: string) => localStorage.getItem(`ui-fixture:${key}`), write: async (key: string, raw: string) => localStorage.setItem(`ui-fixture:${key}`, raw) };
Object.assign(window, { __betaUiFixture: { counters } });
async function main() {
  const text = new TextEncoder().encode(`BEGIN_TEXT\n<script>globalThis.__betaTextExecuted = true</script>\n${'长行'.repeat(10000)}\nEND_TEXT`);
  textOriginalId=crypto.randomUUID();originals.set(`${P}:${textOriginalId}`,text);
  events[events.length - 1].originals = [await picture(),{original_id:textOriginalId,sha256:digest(text),byte_length:text.length,file_name:'合成说明.md',media_type:'text/markdown'}];
  createRoot(document.getElementById('root')!).render(<React.StrictMode><div style={{ height: '100dvh' }} className="flex flex-col overflow-hidden"><p className="shrink-0 bg-surface px-3 py-1 text-center text-[11px] text-muted">交互验收 · 合成档案 · 无真实设备</p><div className="min-h-0 flex-1"><BetaApp client={client} intentJournal={journal} /></div></div></React.StrictMode>);
}
void main();
