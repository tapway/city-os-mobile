---
issue: 21
title: Require a plan and a docs decision on pull requests in city-os-mobile
date: 2026-11-26
---

# Require a plan and a docs decision on pull requests in city-os-mobile — Implementation Plan

**Goal:** Every non-routine pull request in this repo carries a plan and says what happens to the docs.

**Problem:** A pull request can merge into this repo without a plan, and a change to schema or deployment can merge without anyone deciding whether the docs need updating. This repo has no `docs/DEPLOYMENT.md` yet, so a change that triggers that rule must add it or give a reason in the PR.

**Out of scope:** Making the checks required in branch rules, and writing missing docs.

**Before merging:** `master` has a different `workflow-gate.yml`, so bring `master` into `staging` first or the next promotion will conflict.

## Branch 1: ci/add-workflow-checks

### Task 1.1: Turn on the shared checks

**Files:**
- Create: `.github/workflows/workflow-audit.yml`
- Create: `.github/workflows/workflow-gate.yml`
- Create: `.github/workflows/branch-policy.yml`
- Create: `.codemax.yml`

**Acceptance:**
- [ ] `audit`, `contracts` and `Docs impact` run and pass on this pull request
- [ ] A pull request into `master` from any branch but `staging` fails `staging-only`
- [ ] A `staging` to `master` promotion is not asked for a plan or a `Docs:` line
- [ ] Saving a plan in this repo drafts a `codemax` issue and posts nothing

## Test plan

- Read the `audit`, `contracts` and `Docs impact` results on this pull request
- Confirm `git check-ignore docs/plans/x.md` matches nothing
