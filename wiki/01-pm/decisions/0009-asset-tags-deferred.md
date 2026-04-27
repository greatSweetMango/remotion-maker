# ADR-0009: Asset tags filter deferred from TM-13

- **Status**: Accepted
- **Date**: 2026-04-26
- **Context**: TM-13 (AUTH-03) spec calls for filtering asset history by tags. `Asset` Prisma model has no `tags` column today.
- **Decision**: Ship TM-13 without tag filtering. Add `tags String[]` (or join table) in a follow-up task that owns migration + tagging UI on `/studio` + dashboard filter.
- **Consequences**: Dashboard filter row only includes search, date range, sort. Tag filter ticket filed for next sprint.
- **Alternatives**: Add `tags` JSON column inline — rejected (no tag write/edit UI exists, column unfillable).
