# ADR-0004: SQLite-backed Job Queue + Worker Pool

## Status
Accepted

## Context
Object transfer operations are longer-running and should not block request/response lifecycle.

## Decision
Persist jobs in SQLite and process them asynchronously with a local worker queue and retry policy.

## Consequences
### Positive
- Resilient job lifecycle with retries and status polling.
- Better UX with progress tracking.

### Negative
- Requires queue orchestration logic and lifecycle management.

## Alternatives Considered
- Inline processing in API route handlers.
- External queue service (Redis/RabbitMQ) for MVP.
