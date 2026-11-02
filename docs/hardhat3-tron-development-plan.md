# Hardhat 3 TRON implementation plan

Deliver the [compatibility requirements](hardhat3-tron-requirements.md) by reusing upstream TRON behavior behind a Hardhat 3 adapter. Keep the current Hardhat 2 route operational throughout. A stage starts only after the preceding stage has completed review, feedback resolution, validation and commit.

## Stage gates

| Stage | Implementation and deliverable                                                                                                                                                                                                                                              | Required validation                                                                                                                                                                                                                     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0    | Record reuse requirements, capability boundaries, provenance policy and this review/commit workflow. Synchronize the external requirements and plan.                                                                                                                        | Engineering and compatibility reviews; English-only and formatting checks; documentation commit.                                                                                                                                        |
| R1    | Freeze the public plugin subpath, optional-peer/consumer dependency ownership and artifact paths. Import a pinned, licensed upstream runtime/lifecycle baseline; separate registration from reusable behavior; introduce connection-scoped state and explicit dependencies. | Provenance/integrity checks; meaningful isolation and failure/cleanup regression cases; independent reviews and focused commit.                                                                                                         |
| R2    | Add the public Hardhat 3 plugin entry, config/connection/compiler integration and Docker lifecycle. Reuse the ethers facade and expose scoped TRE helpers.                                                                                                                  | Actual Hardhat 3 loading and declaration checks; real Docker TRE deployment/calls/events; two-connection isolation; ordinary-node capability failures; patched-node tests where an identified artifact is available; review and commit. |
| R3    | Add the production TRON template, portable plugin packaging, init/adopt/runtime support and diagnostics.                                                                                                                                                                    | Isolated tgz installation, generated TypeScript/build/test/deploy lifecycle on TRE, negative configuration cases; review and commit.                                                                                                    |
| R4    | Complete six-combination regression, supported-Node checks, CI steps and migration/support documentation. Record ordinary and patched-node results separately.                                                                                                              | Relevant runtime/template/artifact suites, H3 EVM regression, H3 TRON acceptance, lint/format/language checks; final independent reviews and commit.                                                                                    |

## Review and feedback loop

For every stage, the implementation owner reads the affected source and records the actual diff and validation evidence. Two independent reviewers inspect the same stage: engineering quality (types, boundaries, failure paths, maintainability and packaging), and compatibility (Hardhat 2/3, TRON semantics, Docker ownership, helper behavior and acceptance coverage). Reviewers remain read-only and do not rebuild shared artifacts concurrently.

Each finding has a severity, source location, concrete trigger, impact and disposition. Blocking findings are fixed and re-reviewed before commit. A deferral must preserve the requirement boundary and be recorded with its reason; it cannot turn an unverified capability into supported behavior. Behavior-changing fixes receive focused regression checks. Already-passed checks are repeated only after relevant changes or unresolved concerns.

The implementation owner also checks security-sensitive signing, address/unit conversion and cleanup paths directly. Sub-agents do not own core contract review. No stage authorizes registry publication, remote pushes or unrelated cleanup.

## Current evidence

R0 is complete. Hardhat 3/EVM and the native TronWeb/TRE probe predate this plan. They establish a useful baseline, but they do not establish Hardhat 3 ethers-plugin or generated TRON-project acceptance. The current CLI therefore still rejects Hardhat 3/TRON.

The upstream npm package exports neither its ethers bridge nor Docker lifecycle as public modules. Reuse must come from a maintained source adaptation with attribution or a proper upstream public API. Framework-private deep imports and forced peer installation are not delivery mechanisms.

Each stage will add a dated record below with commit scope, reviewers, feedback, test results and remaining limitations.

## Stage records

- 2026-11-02, R0: engineering and compatibility reviewers identified two P2 gaps: packaging was frozen too late, and inherited features lacked an acceptance inventory. Both were addressed by freezing the subpath/dependency boundary before plugin implementation and adding an explicit ordinary/patched-node capability matrix. Both reviewers confirmed closure with no remaining blockers. Prettier, changed-content/name English checks and `git diff --check` passed. The two canonical documents form the R0 commit; external addenda preserve pre-existing edits and are not included in this repository commit.
