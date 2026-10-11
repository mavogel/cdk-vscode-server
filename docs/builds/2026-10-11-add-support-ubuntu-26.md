# Add Support Ubuntu 26 Buildout

Created: 2026-10-11
Author: info@manuel-vogel.de
Agent: Claude Code
Status: VERIFIED
Approved: Yes
Rounds: 1
Worktree: No
Type: Build

## Summary

**Goal:** `LinuxFlavorType.UBUNTU_26` deploys VS Code Server on Ubuntu 26.04 LTS ("resolute") for ARM and x86_64, following the Ubuntu 24 pattern. Follow-up scope (user request, 2026-10-11): Ubuntu 22 and 25 support and their integ tests are removed, leaving only the LTS releases 24 and 26.

**Oracle:** Synthesizing a `VSCodeServer` with `UBUNTU_26` on both CPU architectures resolves the `resolute` Canonical SSM AMI parameter and uses the Ubuntu SSM installer document.

**Misfire:** The enum exists but the AMI lookup throws or the installer falls into the Amazon Linux path; caught by the unit test asserting AMI parameter and Ubuntu SSM document.

**Constraints:** No change to Ubuntu 24 or Amazon Linux 2023 behaviour. Removing `UBUNTU_22` and `UBUNTU_25` is an intentional breaking API change. Follows AGENTS.md "Adding Support for a New Ubuntu Version".

**Assumed:** Codename `resolute` (cloud-images.ubuntu.com/releases lists it); SSM path uses ebs-gp3 like 24. SSM parameter existence was later confirmed live (see Not Verified).

## Acceptance Criteria

- [x] Criterion 1 (oracle): A unit test synthesizing UBUNTU_26 on ARM and x86_64 passes, asserting the `resolute` ebs-gp3 SSM AMI parameter and the `ssm-document-ubuntu` document.
- [x] Criterion 2a: The existing unit test suite passes unchanged.
- [x] Criterion 2b: `npx projen build` completes successfully (compile, awslint, API.md regeneration).
- [x] Criterion 3a: `integ-tests/integ.ubuntu26.ts` exists and mirrored `integ.ubuntu25.ts` (since deleted) and differs from `integ.ubuntu24.ts` only in the OS version and names.
- [x] Criterion 3b: README.md, AGENTS.md and the example comments that enumerate Ubuntu versions each list Ubuntu 26.
- [x] Criterion 4 (follow-up): No reference to `UBUNTU_22`/`UBUNTU_25` remains in `src/`, `test/`, `integ-tests/`, `examples/`, README.md or AGENTS.md, and `integ.ubuntu.ts` and `integ.ubuntu25.ts` with their snapshots are gone.

## Progress Tracking

- [x] Task 1: Add enum, AMI mappings, installer/switch cases
- [x] Task 2: Unit test, integ test, docs
- [x] Task 3: Remove Ubuntu 22 and 25 (enum, mappings, switches, integ tests, docs)

## Implementation Tasks

### Task 1: Add enum, AMI mappings, installer/switch cases

**Objective:** UBUNTU_26 in LinuxFlavorType, resolute SSM paths in mappings, cases in both switches.

### Task 2: Unit test, integ test, docs

**Objective:** Regression test, integ.ubuntu26.ts, doc updates.

### Task 3: Remove Ubuntu 22 and 25

**Objective:** Drop both flavors from code, delete `integ.ubuntu.ts` and `integ.ubuntu25.ts` with snapshots, update docs and examples; AGENTS.md new-version guide now says LTS only.

## Round Log

- Round 0: build-review split compound criteria 2 and 3 (applied).
- Round 1: both tasks built. Judge: 5/5 pass. C1: `npx jest -t ubuntu26` 2 passed (arm64+amd64 resolute params, `vscode-server-ubuntu-` doc). C2a: full jest 41 passed, 1 skipped, exit 0. C2b: `npx projen build` exit 0, API.md gained UBUNTU_26. C3a: diff of integ files shows only names/OS. C3b: diffs of README, AGENTS.md, examples.
- Round 2 (follow-up): Task 3 built on user request. Judge: Criterion 4 pass: grep for `UBUNTU_22|UBUNTU_25|ubuntu22|ubuntu25|jammy|plucky` over `src test integ-tests examples README.md AGENTS.md` finds nothing (the `docs/builds` record excluded); `ls integ-tests` shows only ubuntu24 and ubuntu26. C2a/C2b rerun: jest 41 passed, 1 skipped; `npx projen build` exit 0; API.md no longer lists the removed values.
- Round 3 (follow-up, integ run): first run failed at synth (`KeyMustResolveToString`, pre-existing: Ubuntu 24 integ failed identically) because `src/vscode-server.ts` built IAM5 suppression ids from the unresolved account token. Fixed with `<AWS::AccountId>` placeholder + regression test (failed before, fails with a wrong placeholder). Second run failed at `InstallDotnetApt`: `dotnet-sdk-8.0` is not in the resolute archive. Fixed: Ubuntu 26 installs `dotnet-sdk-10.0` (test added, failed before). Steps 4, 19, 20, 21 verified in an `ubuntu:26.04` container, then the third integ run passed.
- Round 4 (integ regression): recreated Route 53 zone `vscode-server-test.mavogel.xyz` (new id Z0626245RL83TSNC64CW, old Z03751551EDMO1J40VL58 no longer existed), re-delegated the parent `NS` record in mavogel.xyz (Z02503291YUXLE3C4727T), updated `integ.custom-domain.ts`; `dig NS` @8.8.8.8 returned the new name servers. Ran all remaining integ tests with `integ-runner --update-on-failed`: ubuntu24 (eu-west-1, 1098s) pass, custom-domain (eu-west-2, 1360s) pass, al2023 (eu-west-2, 811s) pass, stop-on-idle (eu-west-1, 1138s) pass. Runner warns "destructive changes" (SSM document MAY_REPLACE, domain record / EIP association WILL_REPLACE) because snapshots differ; not a failure. No IntegTest stacks left in either region.
- Side effect: `projen build` rewrote package.json/package-lock.json/.projen/deps.json (integ-runner 2.205.5 -> 2.205.4); reverted with git checkout.

## Changed Files

- src/vscode-server.ts
- src/installer/installer.ts
- src/mappings.ts
- test/vscode-server.test.ts
- integ-tests/integ.ubuntu26.ts
- README.md
- AGENTS.md
- API.md
- examples/custom/main.ts
- examples/custom-install-steps/main.ts
- integ-tests/integ.stop-on-idle.ts (comment reference)
- integ-tests/integ.ubuntu26.ts.snapshot/ (generated by the passing run)
- integ-tests/integ.custom-domain.ts (hosted zone id)
- integ-tests/*.snapshot/ for ubuntu24, custom-domain, al2023, stop-on-idle (regenerated by the runner, unstaged)
- Deleted: integ-tests/integ.ubuntu.ts, integ-tests/integ.ubuntu25.ts and their snapshot directories (unstaged)

## Verification Record

- Profile: API (library, no UI)
- Live target: n/a (CDK construct library; synth-level test)
- Commands:
  - `npx jest` — pass (41 passed, 1 skipped)
  - `npx jest` — pass (44 passed, 1 skipped) after the nag-account and dotnet fixes
  - `integ-runner ... integ.ubuntu26.ts` (eu-west-1) — pass
  - `integ-runner ... integ.ubuntu24.ts` (eu-west-1) — pass
  - `integ-runner ... integ.custom-domain.ts` (eu-west-2) — pass
  - `integ-runner ... integ.al2023.ts` (eu-west-2) — pass
  - `integ-runner ... integ.stop-on-idle.ts` (eu-west-1) — pass
  - `npx projen build` — pass (includes compile, eslint, awslint, jsii, package js/python)
- Reviewers: build-review 2 should_fix (criteria split, applied); changes-review 0 must_fix / 0 should_fix (one cannot_verify, the live SSM check, disclosed in Not Verified)
- Docs: README.md (new "Supported Operating Systems" section with upgrade note), AGENTS.md (per-flavor .NET, nag account placeholder, custom-domain integ prerequisites, single-test command), API.md (generated), example comments
- Regression: jest and `npx projen build` rerun green after the Ubuntu 22/25 removal and after reverting build side effects

## Not Verified

- changes-review was run on the Ubuntu 26 addition only, not re-run after the Ubuntu 22/25 removal.
- `mavogelcdkvscodeserver/` Go bindings (tracked, generated by the release pipeline) are stale and still list `UBUNTU_22`; not regenerated.
- Removing `UBUNTU_22`/`UBUNTU_25` is a breaking API change; release versioning/changelog not addressed.
- Resolved: `integ.ubuntu26.ts` deployed to eu-west-1 and passed (login assertion, 992s); stack destroyed, snapshot written. All five integ tests were later run and passed (see Round 4).
- Ubuntu 26 on x86_64 was not deployed (the integ test uses the default ARM).
- Route 53 changes made outside the repo: new hosted zone Z0626245RL83TSNC64CW and a changed parent NS record; a leftover ACM validation CNAME remains in that zone.
- changes-review was not re-run after the nag-account fix, the dotnet fix, or the zone/snapshot changes.
- Resolved 2026-10-11: `aws ssm get-parameters` in us-east-1 returned both resolute ebs-gp3 params (amd64 ami-080341f184b848d0b, arm64 ami-01d67980b168ae293), no invalid parameters.
