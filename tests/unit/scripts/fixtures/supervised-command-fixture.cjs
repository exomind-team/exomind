const { spawnSync, spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const [mode, dir] = process.argv.slice(2);
// Even a broken runner cannot turn this fixture into a real long hang.
setTimeout(() => process.exit(99), 6500).unref();

if (mode === 'success') { console.log('finite-success'); process.exit(0); }
if (mode === 'failure') { console.error('finite-failure'); process.exit(7); }
if (mode === 'silent') {
  console.log('fixture-ready');
  // A true blocked command: timer callbacks would themselves add Job CPU and
  // could legitimately count as progress on a high-resolution accounting host.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000);
  process.exit(99);
}
if (mode === 'descendant-pipe') {
  const child = spawn(process.execPath, [__filename, 'silent'], { stdio: 'inherit', detached: true });
  console.log(`descendant-pid=${child.pid}`); child.unref(); process.exit(0);
}
if (mode === 'cpu') {
  console.log('cpu-start');
  const end = Date.now() + 1300;
  while (Date.now() < end) Math.sqrt(Math.random());
  process.exit(0);
}
if (mode === 'chatty') {
  setInterval(() => console.log('real-progress'), 50);
} else if (mode === 'suspend-supervisor' || mode === 'kill-watchdog') {
  const status = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8'));
  const target = mode === 'suspend-supervisor' ? status.supervisor : status.watchdog;
  if (!target || (mode === 'suspend-supervisor' && target.pid !== process.ppid)) process.exit(91);
  const helper = join(__dirname, 'supervised-command-test-control.ps1');
  const controlled = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', helper, '-Action', mode], {
    windowsHide: true, stdio: 'inherit', env: { ...process.env, SUPERVISED_TEST_TARGET: JSON.stringify(target) },
    timeout: 4000,
  });
  if (controlled.error || controlled.status !== 0) process.exit(92);
  setInterval(() => {}, 250);
} else {
  console.log('fixture-ready'); setInterval(() => {}, 250);
}
