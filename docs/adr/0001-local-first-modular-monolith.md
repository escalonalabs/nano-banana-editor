# ADR-0001: Modular Monolith Local-First

## Status
Accepted

## Context
The product is single-user local-first, requires deterministic workflows, and should avoid operational overhead from distributed services.

## Decision
Implement a modular monolith in Node.js with clear modules (`app`, `db`, `cas`, `queue`, `pipeline`, `adapter`).

## Consequences
### Positive
- Lower operational complexity and faster iteration.
- Easier local debugging for image processing and job orchestration.

### Negative
- Horizontal scaling is limited compared to distributed services.

## Alternatives Considered
- Microservices with a message broker.
- Pure client-side architecture.
