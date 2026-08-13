# agent-safe-series/v1 + Kindred (#19)

- Local: `garmin_activity_series` 0.7.2+ with duration-anchored coverage
- Kindred: [mi-fitness-data-bridge](https://github.com/shkyyy18/mi-fitness-data-bridge) `v0.3.0` (2026-08-13) ships `workout_series` as `agent-safe-series/v1`; fixture port `ff379c2` + layout tests on their side
- Shared fields: `contract_version`, `t_unit`, `coverage_anchor`, `reference_source`
- **Contract freeze:** additive fields only via proposals on [#19](https://github.com/davidmosiah/garmin-mcp/issues/19) — no unilateral `agent-safe-series/v1` string bump either side
- **Cross-link:** README “Related local-first health MCP” (OK from Kindred on their #8, 2026-08-11). Reciprocal link is live on their README (garmin-mcp + shared contract). Curve constants are still intentionally not byte-identical; both pipelines prove layout-independent stats on the same ride structure.
