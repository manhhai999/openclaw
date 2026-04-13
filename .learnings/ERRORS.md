# ERRORS

## [ERR-20260413-001] smoke-test-environment-vitest-contention

**Logged**: 2026-04-13T21:13:45.715218+09:00
**Priority**: medium
**Status**: pending
**Area**: tests

### Summary

Smoke verification in `openclaw-v2026.4.11-live` was partially blocked by multiple lingering Vitest processes, causing slow/hanging runs and making batch smoke results unreliable.

### Error

```
Batch and per-file Vitest runs stayed active with repeated plugin timing warnings and no timely completion, while multiple older `vitest` processes were still present in the repo.
`openclaw status` and `openclaw gateway status` also did not return promptly during this smoke pass.
```

### Context

- Commands attempted: `pnpm protocol:check`, `pnpm tool-display:check`, grouped and per-file `pnpm exec vitest run ...`, `openclaw status`, `openclaw gateway status`
- `protocol:check` and `tool-display:check` exited 0
- Runtime processes `openclaw` and `openclaw-gateway` were present
- `pgrep -af 'vitest|tsx|node'` showed many lingering Vitest processes from prior runs, especially around `sessions.inspect-control`

### Suggested Fix

Before future smoke passes in this repo, clear stale Vitest processes or run tests in a cleaner environment; treat CLI status hanging as a separate runtime/CLI diagnostic instead of folding it into code regression immediately.

### Metadata

- Reproducible: unknown
- Related Files: .learnings/ERRORS.md
- See Also:

---
