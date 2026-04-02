# Root Cause Taxonomy

Common test failure patterns in actively developed TypeScript/React codebases.
Use this as a classification reference during Phase 2 (Categorize).

## 1. Orphaned Tests (deleted source, surviving test)

**Signature:** `Failed to resolve import "X" from "Y". Does the file exist?`

**Root cause:** Source module was deleted (feature removal, rename) but tests
were not cleaned up in the same commit.

**Fix:** Delete the test files, OR if the feature will return, replace imports
with inline stubs and `describe.skip('reason')`. Note: `describe.skip` alone
is insufficient if Vite resolves imports at transform time before skip logic.

**Prevention:** When deleting a source module, grep `tests/` for its import path.

## 2. Stale Mock (interface evolved, mock didn't follow)

**Signature:**
- `No "X" export is defined on the "Y" mock`
- `TypeError: X.Y is not a function`
- `Cannot read properties of undefined (reading 'Y')`

**Root cause:** Production code added/renamed a method, but the `vi.mock()`
block in the test still reflects the old interface.

**Fix:** Add the missing method/export to the mock. For complex mocks, switch
to `importOriginal` + spread to inherit real exports.

**Prevention:** When changing a module's public API, search for
`vi.mock.*module-name` across the test directory.

## 3. Visibility Condition Not Met

**Signature:** `Unable to find an element with the text: X` where X is
a UI label that should be visible.

**Root cause:** The component's `visible` function requires multiple conditions
(e.g., `developerMode && isTauriWindow`), but the test only sets one.

**Fix:** Set all required conditions in `beforeEach`. If a test within the
same describe block tests the negative case, override back inside that test.

**Prevention:** When writing "element should be visible" tests, trace the
`visible` function and ensure every parameter is explicitly activated.

## 4. Hardcoded Constant Drift

**Signature:** `expected X to be Y` where both X and Y are numbers or
well-known values (ports, URLs, paths).

**Root cause:** A constant (port number, default URL, timeout) changed in
source but tests use hardcoded literals.

**Fix:** Import the constant from source instead of hardcoding. If not
importable, document why the value is hardcoded.

**Prevention:** Never hardcode values that come from a `const` export.

## 5. Incomplete Partial Mock

**Signature:** `No "X" export is defined on the "Y" mock` where X is a
new export the test doesn't use but another module in the import chain does.

**Root cause:** `vi.mock('module', () => ({ A, B }))` only provides A and B,
but a transitive dependency now also imports C from the same module.

**Fix:** Switch to:
```ts
vi.mock('module', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, A: vi.fn(), B: vi.fn() };
});
```

**Prevention:** Default to `importOriginal` + spread pattern for any module
with more than 2-3 exports.

## 6. Source Text Assertion Fragility

**Signature:** `expected 'import { ... }...' to contain 'specificString'`
— the test reads a source file as text and checks for a substring.

**Root cause:** These tests act as architectural guards (e.g., "lib.rs must
call ensure_runtime_started") but break on any refactoring.

**Fix:** Update the assertion string. Consider whether a behavioral test
(import + call + assert result) would be more maintainable.

**Prevention:** Prefer behavioral tests over source text assertions. Reserve
text assertions for truly critical invariants with documented rationale.

## 7. Intentional Behavior Change (test expectations stale)

**Signature:** `expected X to be Y` where the test logic is correct but the
expected value reflects old product behavior.

**Root cause:** A deliberate product change (e.g., hardcoding `ctrl-enter-only`
submit mode, changing default task outcome from `continue` to `suspended`)
was made without updating tests.

**Fix:** Read the component source to understand current behavior, then update
test expectations to match. Do NOT revert the production change.

**Prevention:** When making intentional behavior changes, search for test files
that assert the old behavior. Include test updates in the same PR.
