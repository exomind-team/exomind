# Core8 migration fixture

The source contract workflow creates a synthetic archive from frozen Core8 commit `85f7df92d0eccf1de624ab9220d4d8944797f28b`. The generator exports only that commit's regular Core source files and lockfile into a new directory outside the repository, then runs the archived Core API. It never downgrades a current archive or edits SQLite directly.

The archive contains signed-origin proof rows admitted through Core's trusted Host boundary with fixed synthetic signature bytes; this does not test cryptographic signature verification. It also contains one non-empty original staged, written, verified, and attached through Core8 APIs, plus one timeblock node. The ignored schema8 migration case is run explicitly and verifies the original BLOB and event reference remain usable after upgrade and reopen. This covers those records only; it is not full Beta or full schema-table coverage.

For a local reproduction, choose a new absolute output directory outside the repository. In PowerShell:

```powershell
$core8FixtureOut = Join-Path $env:TEMP ('exomind-core8-' + [guid]::NewGuid().ToString('N'))
bun scripts/dev/beta-core8-fixture.ts --out $core8FixtureOut
$env:EXOMIND_CORE_SCHEMA8_FIXTURE = Join-Path $core8FixtureOut 'synthetic\archive'
cargo test --locked -p exomind-core --test schema8_migration core8_upgrade_preserves_receipts_origin_positions_and_verified_proofs -- --ignored --exact --test-threads=1
Remove-Item Env:EXOMIND_CORE_SCHEMA8_FIXTURE
```

On Termux or another POSIX shell:

```sh
core8Parent=$(mktemp -d)
core8FixtureOut="$core8Parent/fixture"
bun scripts/dev/beta-core8-fixture.ts --out "$core8FixtureOut"
EXOMIND_CORE_SCHEMA8_FIXTURE="$core8FixtureOut/synthetic/archive" cargo test --locked -p exomind-core --test schema8_migration core8_upgrade_preserves_receipts_origin_positions_and_verified_proofs -- --ignored --exact --test-threads=1
```

CI also runs the fixture tool's three focused tests, the grant-management module and record-organization/Hello migration contracts, and an explicit 15-file Beta feature regression set. The existing five UI continuity contracts and Native invariant gate remain part of the source workflow. These source checks are bounded regression coverage, not a complete Beta acceptance result.

The parent executed the three tool tests, strict targeted TypeScript checks, the real Windows CLI generator and the explicit ignored upgrade case. The generated archive retained a readable non-empty original and timeblock through upgrade/reopen. Cargo resolution retains 82 package identities/checksums from the pinned lock and removes 664 unrelated workspace entries. Full metadata resolution is filtered to the Rust host platform; `--no-deps` is insufficient to prune the archived workspace lock before a `--locked` build. No user archive was used. The workflow extension and final candidate still require their own acceptance.
