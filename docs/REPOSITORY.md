# Repository Strategy

## Purpose

This document describes the role of the public `zhihand` repository.

It does **not** enumerate private repositories by name.

## Public Repository Role

`zhihand` is the public core repository for:

- shared protocol definitions
- shared action semantics
- public architecture and boundary documentation
- reference service skeletons
- public host-adapter reference code

## What The Public Repo May Reference

The public repo may describe runtime categories such as:

- host adapters
- mobile apps
- device runtimes
- web runtimes
- deployment-specific services

But it should avoid naming private repositories or embedding private infrastructure details.

## Host Adapter Structure

Public host adapters belong under:

```text
packages/host-adapters/
```

The initial public adapter path starts with OpenClaw. The structure is intentionally extensible to future host environments such as Codex and Claude Code.

## Public / Private Boundary

### Belongs In The Public Repo

- protocol contracts
- action model
- public service semantics
- adapter boundaries
- compatibility documentation

### Does Not Belong In The Public Repo

- private repository names
- secret-bearing deployment logic
- tenant-specific or product-internal infrastructure
- private operational configuration

## Future Decisions

Before adding something new to this public repo, ask:

1. Is it part of the public shared contract?
2. Is it safe to publish?
3. Is it reusable across multiple host environments or runtime categories?

If the answer is mostly no, it likely belongs outside the public core.
