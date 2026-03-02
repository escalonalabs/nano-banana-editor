# ADR-0002: Non-Destructive Snapshots + CAS

## Status
Accepted

## Context
The editor must preserve history and reproducibility while handling repeated image artifacts efficiently.

## Decision
Store binary image payloads in a content-addressable store (CAS) and persist operation lineage as snapshots in SQLite.

## Consequences
### Positive
- Reproducible state per snapshot.
- Efficient deduplication for identical assets.

### Negative
- Additional metadata complexity in the persistence layer.

## Alternatives Considered
- Mutable in-place asset files.
- Full project JSON blobs without CAS.
