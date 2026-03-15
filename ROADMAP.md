# ZhiHand Roadmap

This roadmap describes the public-core view of delivery.

It intentionally focuses on shared contracts and public integration boundaries rather than naming private implementation repositories.

## Phase 1: Shared Control Model

Goal: make the shared control model executable and reusable across multiple host environments and runtime categories.

Primary outcomes:

- `control.proto` is stable enough for real integration.
- `zhihandd` exposes a usable reference control surface.
- A first public host adapter can talk to the same model.
- The shared model is extensible to additional host environments.

Key work:

1. Finalize the first control-domain message set.
2. Implement service skeletons and request routing in `zhihandd`.
3. Define streaming, lifecycle, error, and capability semantics.
4. Wire one end-to-end integration path through the first public host adapter.
5. Publish integration expectations for host adapters, mobile apps, device runtimes, and web runtimes.

Exit criteria:

- Core protocol messages are versioned and documented.
- `zhihandd` can accept and route at least one complete control flow.
- At least one host environment can complete a verified integration against the same protocol.

## Phase 1.5: Deployment Boundary

Goal: define a clean public/private seam so deployment-specific control planes can exist without contaminating the public core.

Primary outcomes:

- The public boundary for pairing issuance is documented.
- The public boundary for endpoint naming and provisioning is documented.
- The public model stays neutral with respect to private infrastructure choices.

Key work:

1. Define the pairing-session boundary exposed by the public model.
2. Define the provisioning boundary between host adapters and deployment-specific control planes.
3. Clarify which capabilities belong in the public core and which belong in private infrastructure.
4. Reserve the seam for future relay and audit features.

## Phase 2: Runtime Categories

Goal: make the public model usable across the main runtime categories.

Primary outcomes:

- Host adapters integrate consistently.
- Mobile apps integrate consistently.
- Device runtimes integrate consistently.
- Web runtimes integrate consistently where appropriate.

Key work:

1. Define capability negotiation and version compatibility rules.
2. Establish authentication, identity, and trust boundaries at the public-contract level.
3. Document device-facing transport assumptions.
4. Build shared integration tests or fixtures around protocol compatibility.

## Phase 3: Productization

Goal: move from a connected prototype to a stable public core suitable for long-term evolution.

Primary outcomes:

- Stable release process for the public core.
- Clear compatibility policy across protocol and adapters.
- Better observability, failure handling, and migration guidance.

Key work:

1. Release versioning and compatibility policy.
2. Deployment and packaging guidance for `zhihandd`.
3. Public logging, tracing, and recovery expectations.
4. Migration guidance for older integrations.

## Open Decisions

- How much host-specific behavior should remain in adapters instead of shared services.
- How far the public model should go in describing deployment control-plane interactions.
- Whether hardware communication needs a separate public transport service in addition to `zhihandd`.

## Current Priority Order

1. `control.proto`
2. `zhihandd`
3. Public host-adapter boundary
4. First host-adapter integration
5. Runtime-category integration contracts
