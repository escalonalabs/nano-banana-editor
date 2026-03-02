# ADR-0003: Hybrid Pipeline (Local Pre/Post + Nano Banana Adapter)

## Status
Accepted

## Context
Quality and control are required for object transfer, but full cloud dependency reduces control and local resilience.

## Decision
Use local deterministic pre/post-processing with optional remote harmonization through a Nano Banana/Imagen adapter.

## Consequences
### Positive
- Pipeline remains functional when remote service is unavailable.
- Better control over edge blending and compositing behavior.

### Negative
- More code paths to maintain.

## Alternatives Considered
- Fully remote black-box editing.
- Fully local model-only processing.
