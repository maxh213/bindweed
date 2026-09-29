# Performance

The marestail perf role maintains this file: one row per task, one column per measured target and metric.

Percentages compare each task's HEAD against its start commit, measured back to back in the same run, not against the row above.

| Task | Commit | Date | Rows | GET / p50 | GET / p95 | GET /assets/app.js p50 | GET /assets/app.js p95 | GET /api/tree p50 | GET /api/tree p95 | GET /api/file p50 | GET /api/file p95 | app listen p50 | app listen p95 | buildTree 500 paths p50 | buildTree 500 paths p95 | filePathSet 500 paths p50 | filePathSet 500 paths p95 | listedRegularFiles p50 | listedRegularFiles p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 001-serve-the-file-tree | 876e8bd | 2026-09-29 | — | 0.3463345ms (new) | 0.74436ms (new) | 0.2460335ms (new) | 0.49839ms (new) | 4.9857995ms (new) | 6.658043ms (new) | 5.303699ms (new) | 7.203095ms (new) | 0.073091ms (new) | 0.098198ms (new) | 1.748912ms (new) | 2.525242ms (new) | 0.0174335ms (new) | 0.020001ms (new) | 4.3702785ms (new) | 5.77297ms (new) |
