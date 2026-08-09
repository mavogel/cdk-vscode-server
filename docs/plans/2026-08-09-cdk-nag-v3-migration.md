# CDK-Nag v3 Migration Implementation Plan

Created: 2026-08-09
Author: info@manuel-vogel.de
Agent: Claude Code
Status: PENDING
Approved: Yes
Iterations: 0
Worktree: No
Type: Feature

## Summary

**Goal:** Upgrade `@mavogel/mvc-projen` to its latest published version (`0.0.30`), which forces `cdk-nag@^3.0.1`, bump `aws-cdk-lib` to `2.261.0` to satisfy cdk-nag v3's `>=2.257.0` floor, and migrate all 19 existing `NagSuppressions` call sites across 7 source files to cdk-nag v3's `Validations.of(...).acknowledge(...)` API so the construct still suppresses its known findings and the test suite still asserts zero unacknowledged violations.

## Out of Scope

- Running `npm run integ-test` (real multi-region AWS deployment) — this plan verifies via local build/lint/synth/snapshot only.
- Bumping `aws-cdk-lib` beyond `2.261.0` to the newest npm release (`2.263.0`) — user chose the version `@mavogel/mvc-projen`'s own migration already validated end-to-end.
- Any `@mavogel/mvc-projen` version beyond `^0.0.30` (latest published as of this plan).
- Re-running the release pipeline / publishing this bump — separate from this plan.

## Approach

**Chosen:** Mirror `@mavogel/mvc-projen`'s own validated cdk-nag v2→v3 migration (commit `76fddc5` in `/Users/mavogel/Developer/projects/mvc-projen`), adapted to this repo's 19 suppression call sites across `src/suppress-nags.ts`, `src/vscode-server.ts`, `src/installer/installer.ts`, `src/secret-retriever/secret-retriever.ts`, `src/idle-monitor-enabler/idle-monitor-enabler.ts`, `src/idle-monitor/idle-monitor.ts`, and `src/prefixlist-retriever/prefixlist-retriever.ts`.
**Why:** That commit already proved the exact API shapes end-to-end against real `aws-cdk-lib@2.261.0` + `cdk-nag@3.0.1` (the author built a standalone harness to confirm 0 unacknowledged violations), so this plan reuses a validated pattern instead of guessing at cdk-nag v3's new API from its changelog alone.

## Global Constraints

- `@mavogel/mvc-projen@^0.0.30` in `.projenrc.ts` `deps` (was `^0.0.25`).
- `cdkVersion: '2.261.0'` in `.projenrc.ts` (was `'2.190.0'`).
- `cdk-nag@^3.0.1` — auto-added by `MvcCdkConstructLibrary` once `@mavogel/mvc-projen` is bumped; do not add it manually in `.projenrc.ts` `deps`.
- Top-level `projen` devDependency must be re-aligned to `^0.101.31` (the version `@mavogel/mvc-projen@0.0.30` itself depends on) — same single-deduped-install reasoning as the prior release-pipeline fix; the existing `depsUpgradeOptions: { exclude: ['projen'] }` guard in `.projenrc.ts` stays as-is (it only blocks the *automated* weekly upgrade from drifting `projen` again, not this deliberate manual bump).

## Context for Implementer

cdk-nag v3 replaces its old `IAspect`-based suppression engine with CDK's native `IPolicyValidationPlugin`/`Validations` framework. Six things matter here:

1. **`NagSuppressions` is fully removed** from cdk-nag v3's public API (verified against the published `cdk-nag@3.0.2` package — no export in any `lib/*.d.ts`). The code will fail to *compile* immediately after the dependency bump lands; this is the expected signal that the migration is required, not a bug to work around. There is no way to land the dependency bump and the suppression-call-site migration as two separately-green tasks — cdk-nag v2 and v3 cannot coexist in one `node_modules` tree, so Task 1 below intentionally bundles both.

2. **Full call-site inventory (verified by `grep -rn "NagSuppressions\." src/`, 19 call sites across 7 files, all importing NagSuppressions from cdk-nag):**

   | File | Call sites | Notes |
   |------|-----------|-------|
   | `src/suppress-nags.ts` | 1 | Uses `addResourceSuppressionsByPath` — see item 3 below |
   | `src/vscode-server.ts` | 9 | Plain `addResourceSuppressions`; includes the IAM4/IAM5 sites noted in item 4 |
   | `src/installer/installer.ts` | 3 | One call uses `appliesTo: ['Resource::*']` on `AwsSolutions-IAM5` — a granular finding, see item 4 |
   | `src/secret-retriever/secret-retriever.ts` | 2 | Plain `addResourceSuppressions`, includes an `IAM4` on a Lambda default execution role |
   | `src/idle-monitor-enabler/idle-monitor-enabler.ts` | 2 | Plain `addResourceSuppressions`, includes an `IAM4` on a Lambda default execution role |
   | `src/idle-monitor/idle-monitor.ts` | 1 | Plain `addResourceSuppressions`, includes `IAM4` + `IAM5` |
   | `src/prefixlist-retriever/prefixlist-retriever.ts` | 1 | Plain `addResourceSuppressions`, `IAM5` |

   Every plain-id call site's third positional argument is `true` (v2's `applyToChildren`) and every resource argument is either a single construct or a single-element array — no call site suppresses more than one resource at once.

3. **`suppress-nags.ts:9` uses `addResourceSuppressionsByPath(stack, path, [{id, reason}])`** — a stack + CloudFormation-path-string form, not a construct instance, so it has no direct `Validations.of(construct)` target. `Validations` operates on construct instances, so the migration must first resolve the construct at that path: `Node.of(stack).findAll().find(c => c.node.path === '<path-without-leading-slash-and-stack-name>')` (the v2 path argument `` `/${stack.stackName}/AWS679f53fac002430cb0da5b7982bd2287/Resource` `` is the CDK construct path, minus the leading slash, relative to `app`, not `stack` — resolve exactly against what `Node.of(stack).findAll()` returns before assuming the string form is directly reusable). If no construct exists at that exact path (i.e. it only exists in the synthesized template, not the construct tree), acknowledge on the nearest resolvable ancestor construct instead and note the substitution in the task's completion notes.

4. **Granular per-resource finding ids — not limited to IAM4/IAM5, and not limited to a fixed applyToChildren cascade.** cdk-nag v3 reports a *granular* id embedding the specific managed-policy or resource ARN for any rule that inherently varies per-resource (confirmed for `AwsSolutions-IAM4`/`AwsSolutions-IAM5` against mvc-projen's own migrated example, `assets/cdk-construct/src_crd-example.ts`), e.g. `AwsSolutions-IAM5[Resource::<SomeLogicalId.Arn>:*]` or `AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]`. `Validations.of(x).acknowledge({id, reason})` rejects any id containing more than one `::` (`aws-cdk-lib`'s internal `Validations.qualifyId` validator), so these granular findings need the bypass helper mvc-projen already wrote and validated:

   ```typescript
   function acknowledgeGranularFinding(construct: Construct, id: string, reason: string): void {
     construct.node.addMetadata(Validations.ACKNOWLEDGED_RULES_METADATA_KEY, { [id]: reason });
   }
   ```

   Separately, v2's third `true` argument (`applyToChildren`) has **no stated v3 equivalent** — `acknowledge()`/the metadata bypass are per-construct, with no built-in cascade to CDK-generated children (e.g. a `Provider`'s internal `LogRetention`/framework-onEvent constructs). A suppression that relied on `applyToChildren` may reappear as a violation on a child construct v3 reports separately.

   Because of both points, the exact set of ids and the constructs they must be acknowledged on **cannot be fully predicted from reading the v2 code** — they depend on this repo's specific construct ids, attached policies, and whatever child constructs v3 walks into. Task 1's recipe: migrate every call site to `Validations`/the bypass helper using the v2 id as a first guess, run the rewritten cdk-nag test with `verbose: true`, read every reported violation id from `policy-validation-report.json`, and add one `acknowledge()`/`acknowledgeGranularFinding()` call per reported id — for ANY rule, not only IAM4/IAM5 — until the violation count is 0. Do not hand-author guessed granular ids; every granular id in the final diff must have been copied from an actual report run.

5. **`suppress-nags.ts`'s target, `AWS679f53fac002430cb0da5b7982bd2287`, is a CDK-owned singleton Lambda logical id** (from CDK's built-in `AwsCustomResource`), which can change across a version jump this large. If it isn't found at the expected path, don't force an ancestor acknowledgement first — check whether the `AwsSolutions-L1` entry in `policy-validation-report.json` names a different path for the same singleton, and acknowledge there instead; only fall back to the nearest ancestor if the finding doesn't appear at all.

6. **Two artifacts outside `src/` reference cdk-nag and are not part of the migration itself:**
   - `mavogelcdkvscodeserver/` (committed Go bindings, generated by `jsii-pacmak`) pins `github.com/cdklabs/cdk-nag-go/cdknag/v2` in `go.mod` and `jsii/jsii.go`. `publishToGo` is commented out in `.projenrc.ts` (confirmed), so `npx projen build`/`package-all` does not regenerate this directory — it's a pre-existing stale artifact, unrelated to this migration. Leave it untouched (mention, don't fix, per lineage rules) rather than hand-editing it to reference `cdknag/v3`.
   - `renovate.json5` lists `cdk-nag` inside its Renovate-ignore array, but the file carries a `~~ Generated by projen` banner — it's fully regenerated by `npx projen` from `.projenrc.ts`'s `renovatebotOptions`, so no manual edit is needed there.

## Assumptions

- `Validations` (with `.of()`, `.acknowledge()`, `ACKNOWLEDGED_RULES_METADATA_KEY`) and `AwsSolutionsChecks`'s new `(app, options)` constructor signature exist in `aws-cdk-lib@2.261.0` / `cdk-nag@3.0.1` exactly as used in mvc-projen's validated migration — not independently re-verified against those exact versions' own `.d.ts` in this planning session (they aren't installed yet). Task 1's first step (below) verifies this immediately after `npm install`, before any source file is touched, specifically because the fallback is NOT "adjust syntax mechanically" for every case: if `ACKNOWLEDGED_RULES_METADATA_KEY` is not publicly exported, the granular-finding bypass helper — the plan's only mechanism for IAM4/IAM5 and other ARN-embedded findings — has no implementation and there is no fallback within this plan's approach. In that case, stop and report back rather than improvising a metadata key string or a different bypass mechanism (that would be a design change, not a mechanical syntax fix).

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Guessed/incomplete granular finding ids (any rule, not just IAM4/IAM5) leave real findings silently unacknowledged, and the test passes anyway | Medium | Medium | Task 1's DoD requires an observed 0-violation run (via the report), not just "code compiles" — ids are discovered empirically from actual report output, never hand-guessed |
| `Validations`/`ACKNOWLEDGED_RULES_METADATA_KEY` API differs from or is absent in the actual installed `aws-cdk-lib@2.261.0`/`cdk-nag@3.0.1` | Low | High | Task 1's first step verifies the API shape immediately after `npm install`, before touching any source file; absence of the metadata key export is a stop-and-report condition, not an improvised workaround |
| The 71-minor-version `aws-cdk-lib` jump (2.190.0 → 2.261.0) changes CDK L2 default behavior beyond cdk-nag itself (VPC/CloudFront/Lambda/etc. defaults), silently altering the deployed stack | Medium | High | Task 2 requires a manual review of the regenerated Jest snapshot diff — not a blind `jest -u` accept — and any security- or behavior-relevant change gets called out explicitly in the completion report |
| jsii 5.9→6.0 (bundled with the `@mavogel/mvc-projen` bump) breaks `jsii-diff`/`jsii-pacmak`/docgen compatibility | Low | Medium | Covered by Task 2's full `npx projen build`, which runs all three; any incompatibility surfaces as a build failure to fix before the plan is done |
| Task 1's long red-build window (7 files + regenerated lockfile) has no stated recovery point if the Validations API assumption fails mid-migration | Low | Medium | Key Decisions below requires a clean git checkpoint (commit hash noted, or a user-approved commit/stash) before `npx projen` runs, so an abort can restore the pre-migration green v2 tree via `git reset --hard <hash>` (with user permission) followed by `npm ci` to rebuild `node_modules` at the v2 lockfile — a bare git restore alone leaves a v3 `node_modules` behind |

## Progress Tracking

- [ ] Task 1: Bump mvc-projen/cdkVersion and migrate cdk-nag v2 → v3
- [ ] Task 2: Regenerate snapshots and verify full build

## Implementation Tasks

### Task 1: Bump mvc-projen/cdkVersion and migrate cdk-nag v2 → v3

**Objective:** Bump `@mavogel/mvc-projen` to `^0.0.30` and `cdkVersion` to `2.261.0` in `.projenrc.ts`, re-synth the generated project files, verify the `Validations` API shape actually installed, then migrate every `NagSuppressions` call site across all 7 affected source files (see Context item 2's inventory table) plus the cdk-nag test block in `test/vscode-server.test.ts` to cdk-nag v3's `Validations` API, discovering the exact granular finding ids empirically. Also updates `CLAUDE.md`'s stale "CDK-nag Integration" section and sweeps README/examples for any other stale reference.

**Files:**

- Modify: `.projenrc.ts` (`deps` mvc-projen version, `cdkVersion`)
- Modify: `package.json`, `package-lock.json`, `.projen/tasks.json`, `.projen/deps.json`, `.projen/files.json` (regenerated by `npx projen`, not hand-edited)
- Modify: `src/suppress-nags.ts`
- Modify: `src/vscode-server.ts`
- Modify: `src/installer/installer.ts`
- Modify: `src/secret-retriever/secret-retriever.ts`
- Modify: `src/idle-monitor-enabler/idle-monitor-enabler.ts`
- Modify: `src/idle-monitor/idle-monitor.ts`
- Modify: `src/prefixlist-retriever/prefixlist-retriever.ts`
- Modify: `test/vscode-server.test.ts`
- Modify: `CLAUDE.md`

**Key Decisions / Notes:**

- **Checkpoint first:** ensure the working tree is clean and note the current commit hash before running `npx projen` — this task's red-build window spans 7 source files and a regenerated lockfile. If the Assumptions section's API-shape bet turns out wrong and Task 1 must be aborted, the recovery path is `git reset --hard <checkpoint-hash>` (ask the user for permission first — this discards the in-progress migration) followed by `npm ci` to rebuild `node_modules` back at the v2 lockfile; a bare `git checkout` of individual files would leave a v3 `node_modules` installed against v2 source.
- **Verify the API before migrating any source file:** after `npm install` picks up the bumped deps, read `node_modules/aws-cdk-lib/core/lib/validation/*.d.ts` and confirm `Validations.of()`, `.acknowledge()`, `.addPlugins()`, and `ACKNOWLEDGED_RULES_METADATA_KEY` are exported as used in mvc-projen's reference migration, and confirm `cdk-nag`'s `AwsSolutionsChecks` constructor accepts `(app, options)`. If `ACKNOWLEDGED_RULES_METADATA_KEY` (or any of the above) is missing or shaped differently, STOP — do not improvise a different bypass mechanism — revert to the checkpoint and report back.
- Same version-alignment reasoning as the prior release-pipeline `/fix`: after bumping `@mavogel/mvc-projen`, also `npm install --save-dev projen@^0.101.31` (or let `npx projen` re-resolve it) so the top-level `projen` matches what `0.0.30` needs — a single deduped install, not a nested copy with mismatched builtin task names.
- Follow the `Context for Implementer` recipe (items 2–4) for the full inventory, the `addResourceSuppressionsByPath` construct-resolution step in `suppress-nags.ts`, and the empirical granular-id discovery loop covering every rule (not only IAM4/IAM5).
- Test rewrite pattern (mirrors mvc-projen's validated `assets/cdk-construct/test_index.test.ts`): construct `app` as `new App({ context: { '@aws-cdk/core:validationReportJson': true } })`; register the plugin via `Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }))`; replace the two existing `Annotations.fromStack(...).findWarning/findError` tests with a single test that calls `app.synth()`, reads `<assembly.directory>/policy-validation-report.json` (treat a missing file as zero violations rather than throwing — some CDK versions omit the report entirely when there is nothing to report), flat-maps `pluginReports[].violations`, and asserts the array has length 0. Additionally assert the report/plugin actually ran against the full construct tree (e.g. a non-empty `pluginReports` array, or a known-nonzero count of acknowledged rules) so an accidentally-under-synthesized app can't produce a false-positive 0.
- The scope moves from stack-level (`Aspects.of(stack)`, v2) to app-level (`Validations.of(app)`, v3), and the single `violations` array replaces two separate warning/error assertions. Confirm `violations` merges both severities (not just errors) by temporarily removing one known `acknowledge()` call and re-running the test — it must reappear as a violation — before restoring it; note the confirmed severity behavior in the completion report rather than assuming it from the API name.
- Update `CLAUDE.md` line ~201 ("Apply suppressions via `NagSuppressions.addResourceSuppressions()`") to describe `Validations.of(...).acknowledge(...)` instead. Also run `grep -rn "NagSuppressions\|cdk-nag" README.md examples/ API.md renovate.json5 .projenrc.ts` and update any other stale reference found in the same change (Context item 6 already covers why `renovate.json5` itself needs no manual edit).
- In the completion report, list every acknowledged id (plain and granular) mapped to the v2 suppression it replaces, so any dropped or newly-appeared id is visible rather than silently absorbed into a passing test.

**Definition of Done:**

- [ ] `package.json` shows `@mavogel/mvc-projen: ^0.0.30`, `cdk-nag: ^3.0.1`, and `aws-cdk-lib` peer/dev at `2.261.0`/`^2.261.0`
- [ ] `grep -rn "from 'cdk-nag'" src/` shows no `NagSuppressions` import anywhere (all 7 previously-importing files migrated)
- [ ] The rewritten cdk-nag test in `test/vscode-server.test.ts` observes 0 entries in `policy-validation-report.json`'s violations when run, and confirms the plugin actually executed (non-empty report / non-zero acknowledged-rule count)
- [ ] Verify: `npx jest test/vscode-server.test.ts -t "cdk-nag"` passes (0 failures)

### Task 2: Regenerate snapshots and verify full build

**Objective:** Regenerate the Jest CloudFormation-template snapshots against the new `aws-cdk-lib` version, manually review the diff for anything beyond expected drift, and run the full `npx projen build` (lint, full test suite, `package:js`, `package:python`) to confirm nothing else broke — including that `integ-tests/*.ts` still type-checks under the bumped `aws-cdk-lib`/`@aws-cdk/integ-tests-alpha`.

**Files:**

- Modify: `test/__snapshots__/vscode-server.test.ts.snap`
- Modify: `API.md` (docgen output, regenerated by `npx projen build`)
- Modify: any `src/*.ts` file needing a jsii 5.9→6.0 compatibility fix, if the build surfaces one (not expected, but in scope if it happens)

**Key Decisions / Notes:**

- Run `npx jest test/vscode-server.test.ts -u` to regenerate, then `git diff test/__snapshots__/` and read it — every changed line should be attributable to the `aws-cdk-lib` 2.190.0→2.261.0 bump (e.g. updated construct metadata, changed default resource properties). If anything looks security- or behavior-relevant (e.g. a changed IAM policy, a removed encryption setting), call it out explicitly in the completion report rather than silently accepting the snapshot.
- `integ-tests/*.ts` has no hardcoded `aws-cdk-lib`/`cdk-nag` version references (confirmed during planning) — it just needs to still compile, which the full build's TypeScript step covers; no separate task needed.
- `npx projen build` regenerates `API.md` via docgen — expect it to change (new/renamed types from the jsii bump are unlikely but possible) and let it land as part of this task rather than treating it as scope creep.

**Definition of Done:**

- [ ] Snapshot diff reviewed; only attributable-to-CDK-bump changes remain (or none)
- [ ] `npx projen build` exits 0 (lint, full test suite, `package:js`, `package:python`)
- [ ] Verify: `npx projen build`
