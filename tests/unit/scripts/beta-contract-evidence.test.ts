// @vitest-environment node
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativeBindings, verifyIntentPlan, verifyNativeProof, verifyUiProof, UI_REGRESSIONS } from '../../../scripts/dev/beta-contract-evidence';

const contract = () => ({ name:'fixture-contract', completion_criteria:[{name:'Main absent',test_selector:{package:'fixture',filter:'user_without_main'}}] });
function lifecycle() {
  return {passed:true,stage:'complete',quality_score:1,verification:{spec_name:'fixture-contract',
    summary:{total:1,passed:1,failed:0,skipped:0,uncertain:0,pending_review:0},
    results:[{scenario_name:'Main absent',verdict:'pass',provenance:'computational',step_results:[{verdict:'pass'}],
      evidence:[{type:'test_output',package:'fixture',test_name:'fixture::user_without_main',passed:true,
        stdout:'test result: ok. 0 passed; 0 failed; 0 ignored;\ntest result: ok. 1 passed; 0 failed; 0 ignored;'}]}]}};
}
function uiReport(root:string) {
  return {success:true,numTotalTests:Number(UI_REGRESSIONS.length),numPassedTests:Number(UI_REGRESSIONS.length),numFailedTests:0,numPendingTests:0,
    testResults:UI_REGRESSIONS.map(file=>({name:resolve(root,file),assertionResults:[{status:'passed'}]}))};
}

describe('Beta contract proof acceptance',()=>{
  it('accepts actual selected executions while unrelated Cargo targets contain zero matches',()=>{
    expect(verifyNativeProof(nativeBindings(contract()),lifecycle())).toEqual({scenarios:1,executedTests:1});
  });
  it('rejects exit-zero evidence when the selected Rust test did not run',()=>{
    const report=lifecycle();report.verification.results[0].evidence[0].stdout='test result: ok. 0 passed; 0 failed; 0 ignored;';
    expect(()=>verifyNativeProof(nativeBindings(contract()),report)).toThrow();
  });
  it.each(['skip','uncertain','pending_review','fail'])('rejects %s even if the outer checkbox says passed',verdict=>{
    const report=lifecycle();report.verification.results[0].verdict=verdict;
    expect(()=>verifyNativeProof(nativeBindings(contract()),report)).toThrow();
  });
  it('rejects model inference and mismatched selectors as mechanical proof',()=>{
    const inferred=lifecycle();inferred.verification.results[0].provenance='inferential';
    expect(()=>verifyNativeProof(nativeBindings(contract()),inferred)).toThrow();
    const wrong=lifecycle();wrong.verification.results[0].evidence[0].test_name='fixture::another_test';
    expect(()=>verifyNativeProof(nativeBindings(contract()),wrong)).toThrow();
  });
  it('rejects absent, duplicate and unbound contract obligations',()=>{
    expect(()=>nativeBindings({name:'empty',completion_criteria:[]})).toThrow();
    const duplicate=contract();duplicate.completion_criteria.push({...duplicate.completion_criteria[0]});
    expect(()=>nativeBindings(duplicate)).toThrow();
    expect(()=>nativeBindings({name:'unbound',completion_criteria:[{name:'missing selector'}]})).toThrow();
  });
  it('rejects an unexpected scenario instead of trusting the summary count',()=>{
    const report=lifecycle();report.verification.results[0].scenario_name='another scenario';
    expect(()=>verifyNativeProof(nativeBindings(contract()),report)).toThrow();
  });
  it('accepts the CLI boundary obligation separately from executed business scenarios',()=>{
    const report=lifecycle();
    report.verification.summary.total++; report.verification.summary.passed++;
    report.verification.results.push({...report.verification.results[0],
      scenario_name:'[boundaries] explicit change set respects declared paths', evidence:[]});
    expect(verifyNativeProof(nativeBindings(contract()),report)).toEqual({scenarios:1,executedTests:1});
    report.verification.results[1].verdict='fail';
    expect(()=>verifyNativeProof(nativeBindings(contract()),report)).toThrow();
  });
  it('does not accept an arbitrary passing extra obligation',()=>{
    const report=lifecycle(); report.verification.summary.total++; report.verification.summary.passed++;
    report.verification.results.push({...report.verification.results[0],scenario_name:'invented pass'});
    expect(()=>verifyNativeProof(nativeBindings(contract()),report)).toThrow();
  });
  it('accepts only the explicitly selected UI files with all assertions executed',()=>{
    const root=resolve('synthetic-code-root');expect(verifyUiProof(root,uiReport(root))).toEqual({files:UI_REGRESSIONS.length,executedTests:UI_REGRESSIONS.length});
    const zero=uiReport(root);zero.numTotalTests=0;zero.numPassedTests=0;zero.testResults=[];
    expect(()=>verifyUiProof(root,zero)).toThrow();
    const skipped=uiReport(root);skipped.testResults[0].assertionResults[0].status='pending';
    expect(()=>verifyUiProof(root,skipped)).toThrow();
    const wrong=uiReport(root);wrong.testResults[0].name=resolve(root,'tests/unrelated.test.ts');
    expect(()=>verifyUiProof(root,wrong)).toThrow();
  });
});

describe('Beta intent plan admission',()=>{
  const plan=()=>({version:1,requirements:[{id:'REQ-BETA-RUNTIME',status:'ready'}],
    work_units:[{id:'WU-REQ-BETA-RUNTIME',requirement_id:'REQ-BETA-RUNTIME',status:'ready'}],
    specs:[{name:'beta-runtime-invariants',satisfies:['REQ-BETA-RUNTIME']}],diagnostics:[],parse_errors:[]});
  it('accepts the CLI ready plan for the pilot contract',()=>{
    expect(()=>verifyIntentPlan(plan(),'beta-runtime-invariants')).not.toThrow();
  });
  it('rejects missing, empty and malformed plans',()=>{
    for (const value of [{}, {...plan(),requirements:[]}, {...plan(),work_units:[]}, {...plan(),specs:[]}]) {
      expect(()=>verifyIntentPlan(value,'beta-runtime-invariants')).toThrow();
    }
  });
  it('rejects blocked requirements, diagnostics and a different contract',()=>{
    const blocked=plan(); blocked.requirements[0].status='blocked';
    expect(()=>verifyIntentPlan(blocked,'beta-runtime-invariants')).toThrow();
    expect(()=>verifyIntentPlan({...plan(),diagnostics:[{severity:'error'}]},'beta-runtime-invariants')).toThrow();
    expect(()=>verifyIntentPlan(plan(),'another-contract')).toThrow();
  });
});
