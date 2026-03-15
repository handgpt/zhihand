# Host Adapters

This directory contains public host-adapter packages for ZhiHand.

The purpose of a host adapter is to translate a host environment's native events, tools, and session model into the shared ZhiHand control model.

Current public adapter path:

- `openclaw/`

Public adapter-specific configuration and tool behavior should be documented in
the adapter package itself. For the current adapter, see:

- `openclaw/README.md`

Potential future host adapters may target environments such as:

- Codex
- Claude Code
- other plugin-capable or tool-capable hosts

Host adapters should remain thin and should not define a competing protocol.
