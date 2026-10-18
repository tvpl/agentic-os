# Internal documents

History and working notes of the project: analyses, audits, plans, validation runs and reviews written while the
product was being built. **They are not documentation of the product.** They describe the interface and the
architecture as they were on the day each was written (many mention screens, widgets and files that no longer
exist), some contain absolute paths of the machine they were written on, and nothing here is the source of a
statement the product makes.

- The installer does not carry this folder: `scripts/package.mjs` copies `ui`, `seed` and `package.json`,
  and `tests/docs.drift.test.ts` fails if a path under `docs/` ever enters that list.
- The product guides stay one level up, in [`docs/`](..): [user manual](../user-manual.md),
  [architecture](../architecture.md), [security](../security.md), [install](../install.md), [SDK](../sdk.md).

## Where each entry came from

The specs under `.specs/` and some comments cite these documents by their old path. The map:

| Old path | Now | What it is |
| --- | --- | --- |
| `docs/analysis-2026-09/` | [`analysis-2026-09/`](analysis-2026-09/README.md) | competitive analysis of September 2026 |
| `docs/audit-2026-09/` | [`audit-2026-09/`](audit-2026-09/README.md) | technical and interface audit of 1 September 2026 |
| `docs/plan-2026-09/` | [`plan-2026-09/`](plan-2026-09/README.md) | evolution plan of September 2026 |
| `docs/execution-2026-09-06/` | [`execution-2026-09-06/`](execution-2026-09-06/acceptance.md) | acceptance, baseline and capacity runs |
| `docs/review-2026-09-06/` | [`review-2026-09-06/`](review-2026-09-06/README.md) | product review and gauntlet of 6 September 2026 |
| `docs/plans/` | [`plans/`](plans/) | the desktop, the immersive shell and the progress notes |
| `docs/analise-engine-ui-2026-09-12.md` | [`analise-engine-ui-2026-09-12.md`](analise-engine-ui-2026-09-12.md) | engine and interface analysis of 12 September 2026 |
| `docs/validation-report.md` | [`validation-report.md`](validation-report.md) | validation of version 0.1.0 |
