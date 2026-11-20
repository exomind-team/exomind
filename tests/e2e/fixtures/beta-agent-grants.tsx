import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BetaAgentGrantsEntry } from '../../../src/beta/BetaAgentGrantsPanel';
import type { AgentGrantMetadata, AgentGrantsClient } from '../../../src/beta/agent-grants-client';
import '../../../src/index.css';
import '../../../src/beta/beta-ui.css';

// Renderer-only layout fixture. No Native credentials, device or user archive.
const profileId='11111111-1111-4111-8111-111111111111';
const grant:AgentGrantMetadata={profile_id:profileId,grant_id:'22222222-2222-4222-8222-222222222222',kind:'observer',agent_id:null,revoked:false};
const handle='33333333-3333-4333-8333-333333333333';
const client:AgentGrantsClient={
  list:async()=>[{...grant}],
  issue:async()=>{throw new Error('Issuance is outside this layout fixture');},
  recover:async()=>({grant:{...grant},issuance:'recovered',credential_handle:handle,credential_state:'available'}),
  copyAccessInfo:async()=>({credential_handle:handle,credential_state:'copied',material_retained:true}),
  releaseCredential:async()=>({material_released:true,credential_state:'unavailable'}),
  revoke:async()=>({grant:{...grant,revoked:true},credential_material_released:true,completion:'confirmed'}),
};
document.documentElement.classList.add('beta-ui');
document.documentElement.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches);
createRoot(document.getElementById('root')!).render(<StrictMode><main className="min-h-dvh bg-page p-4 text-primary"><BetaAgentGrantsEntry client={client} profileId={profileId} profileName="合成授权布局" visible/></main></StrictMode>);
