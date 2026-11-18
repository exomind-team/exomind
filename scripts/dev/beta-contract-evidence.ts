import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

export const UI_REGRESSIONS = [
  'tests/unit/beta/presentation-independence.test.tsx',
  'tests/unit/beta/main-workspace-client.test.tsx',
  'tests/unit/beta/overlay-surface.test.tsx',
  'tests/unit/beta/original-export-ui.test.tsx',
] as const;

export interface NativeBindings {
  specName: string;
  scenarios: {name: string; package: string; filter: string}[];
}
function requireProof(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(`Beta contract proof rejected: ${reason}`);
}
function object(value: unknown): Record<string, unknown> {
  requireProof(value && typeof value === 'object' && !Array.isArray(value), 'expected an object');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  requireProof(Array.isArray(value), 'expected an array'); return value;
}
function text(value: unknown): string {
  requireProof(typeof value === 'string' && value.length > 0, 'expected a nonempty string'); return value;
}

/** Read bindings from the CLI-rendered contract; do not maintain another spec parser. */
export function nativeBindings(value: unknown): NativeBindings {
  const contract = object(value), names = new Set<string>(), selectors = new Set<string>();
  const scenarios = array(contract.completion_criteria).map(value => {
    const scenario = object(value), selector = object(scenario.test_selector);
    const name = text(scenario.name), packageName = text(selector.package), filter = text(selector.filter);
    requireProof(/^[A-Za-z0-9_-]+$/.test(packageName) && /^[A-Za-z_][A-Za-z0-9_:]*$/.test(filter), 'unsupported Native test selector');
    const key = `${packageName}::${filter}`;
    requireProof(!names.has(name) && !selectors.has(key), 'duplicate scenario or test selector');
    names.add(name); selectors.add(key); return {name, package: packageName, filter};
  });
  requireProof(scenarios.length > 0, 'contract has zero scenarios');
  return {specName: text(contract.name), scenarios};
}

/** Admit the CLI's plan, without building a second intent compiler. */
export function verifyIntentPlan(value: unknown, specName: string, expectedScenarios: number): void {
  const plan = object(value);
  requireProof(plan.version === 1, 'unsupported intent plan');
  requireProof(array(plan.parse_errors).length === 0 && array(plan.diagnostics).length === 0, 'intent plan has diagnostics');
  const requirements = array(plan.requirements).map(object), units = array(plan.work_units).map(object);
  requireProof(requirements.length > 0 && requirements.every(row=>row.status === 'ready'), 'requirements are not ready');
  requireProof(units.length > 0 && units.every(row=>row.status === 'ready'), 'work units are not ready');
  const spec = array(plan.specs).map(object).find(row=>row.name === specName);
  requireProof(spec && array(spec.satisfies).includes('REQ-BETA-RUNTIME'), 'pilot contract is absent from intent plan');
  requireProof(requirements.some(row=>row.id === 'REQ-BETA-RUNTIME') && units.some(row=>row.requirement_id === 'REQ-BETA-RUNTIME'), 'pilot requirement has no ready work unit');
  const requirement = requirements.filter(row=>row.id === 'REQ-BETA-RUNTIME');
  const workUnits = units.filter(row=>row.requirement_id === 'REQ-BETA-RUNTIME');
  requireProof(Number.isSafeInteger(expectedScenarios) && expectedScenarios > 0, 'contract scenario count is missing');
  requireProof(requirement.length === 1 && workUnits.length === 1 && requirement[0].scenario_count === expectedScenarios && workUnits[0].scenario_count === expectedScenarios, 'accepted requirement, work unit and contract scenario counts disagree');
}

export function verifyNativeProof(bindings: NativeBindings, value: unknown) {
  const report = object(value), verification = object(report.verification), summary = object(verification.summary);
  requireProof(report.passed === true && report.stage === 'complete' && typeof report.quality_score === 'number' && report.quality_score >= 0.7, 'lifecycle is not passing');
  requireProof(verification.spec_name === bindings.specName, 'wrong contract identity');
  for (const key of ['failed','skipped','uncertain','pending_review']) requireProof(summary[key] === 0, `non-passing verdict: ${key}`);
  const results = array(verification.results).map(object);
  const boundaryName = '[boundaries] explicit change set respects declared paths';
  const boundaries = results.filter(row=>row.scenario_name === boundaryName);
  requireProof(boundaries.length <= 1 && results.length === bindings.scenarios.length + boundaries.length && new Set(results.map(row=>row.scenario_name)).size === results.length, 'duplicate, unknown or missing scenario results');
  requireProof(summary.total === results.length && summary.passed === results.length, 'incomplete scenario coverage');
  for (const boundary of boundaries) {
    requireProof(boundary.verdict === 'pass' && boundary.provenance === 'computational', 'boundary check did not pass mechanically');
    const steps = array(boundary.step_results).map(object);
    requireProof(steps.length > 0 && steps.every(step=>step.verdict === 'pass'), 'unsettled boundary check');
  }
  let executedTests = 0;
  for (const binding of bindings.scenarios) {
    const result = results.find(row=>row.scenario_name === binding.name);
    requireProof(result?.verdict === 'pass' && result.provenance === 'computational', `no mechanical pass for ${binding.name}`);
    const steps = array(result.step_results).map(object);
    requireProof(steps.length > 0 && steps.every(step=>step.verdict === 'pass'), `unsettled steps for ${binding.name}`);
    const evidence = array(result.evidence).map(object).filter(row=>row.type === 'test_output');
    requireProof(evidence.length === 1, `missing or ambiguous test execution for ${binding.name}`);
    const output = evidence[0];
    requireProof(output.passed === true && output.package === binding.package && output.test_name === `${binding.package}::${binding.filter}`, `wrong test execution for ${binding.name}`);
    const stdout = stripVTControlCharacters(text(output.stdout));
    requireProof(!stdout.includes('test result: FAILED'), `failed Rust target for ${binding.name}`);
    const counts = [...stdout.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;/g)];
    requireProof(counts.length > 0 && counts.every(row=>Number(row[2]) === 0 && Number(row[3]) === 0), `missing or skipped Rust results for ${binding.name}`);
    const passed = counts.reduce((sum,row)=>sum+Number(row[1]),0);
    requireProof(passed === 1, `expected one selected Rust test for ${binding.name}, got ${passed}`);
    executedTests += passed;
  }
  return {scenarios: bindings.scenarios.length, executedTests};
}

export function verifyUiProof(root: string, value: unknown) {
  const report = object(value), files = array(report.testResults).map(object);
  const canonical = (path: string) => process.platform === 'win32' ? resolve(root,path).toLowerCase() : resolve(root,path);
  const expected = new Set(UI_REGRESSIONS.map(canonical)), seen = new Set<string>();
  requireProof(report.success === true && report.numFailedTests === 0 && report.numPendingTests === 0, 'UI checks are not passing');
  requireProof(files.length === expected.size, 'wrong UI file coverage');
  let executedTests = 0;
  for (const file of files) {
    const name = canonical(text(file.name));
    requireProof(expected.has(name) && !seen.has(name), 'unexpected or duplicate UI test file'); seen.add(name);
    const assertions = array(file.assertionResults).map(object);
    requireProof(assertions.length > 0 && assertions.every(test=>test.status === 'passed'), 'UI assertions were skipped or failed');
    executedTests += assertions.length;
  }
  requireProof(executedTests > 0 && report.numTotalTests === executedTests && report.numPassedTests === executedTests, 'UI counts do not match executed assertions');
  return {files: seen.size, executedTests};
}
