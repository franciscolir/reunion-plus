## Objective
- Make Monday (lunes) the first day of the week across the entire app — refactor the week key from `saturday` to `monday` in all code AND migrate existing persisted data in IndexedDB.

## Important Details
- Previous two-step form pattern work is COMPLETE and merged (PRs #16, #17, #18, #19, #20).
- `weekKeyOf` (app.js:816) returns Monday (was Sunday). Merged in PR #20.
- New canonical week fields: every week object carries `monday`, `saturday`, `sunday`. `monday` is the key used for matching/lookups; `saturday` retained for display (weekend meeting date).
- `newWeek(date)` receives Monday: sets `monday`, `saturday = addDays(mon,5)`, `date = sat` (compat).
- `mondaysOf(year,month)` + `weekMondayOf(iso)` added to logic.js. `saturdaysOf` kept (used by tests).
- `wmon(w)` helper in app.js derives the Monday key from `monday`/`date`/`saturday` so legacy data without `monday` still matches (defensive).
- IndexedDB migration v12 (db.js) adds `monday`/`sunday` to all weeks in months/aseos/atencion/salidas (derives from existing `saturday`/`date`). DB_VERSION bumped 11→12.
- sync.js `desplegarPrograma` now sets `monday` when pulling from Supabase (Supabase `fecha` stays Saturday — backward compatible storage key).
- Non-synced stores use `commitSilent`: cargos, capacidades, restricciones, excepciones, speaker_talks, audit_log.
- Año de servicio: septiembre–agosto.
- Branch: `refactor/semana-lunes` (committed work in progress).
- Tests: 522 unit + 24 integration + 39 E2E = 585 PASS, 0 FAIL.
- E2E test DB-open versions were bumped 11→12 to match new DB_VERSION (app.js opens v12 first).

## Work State
### Completed
- Two-step form pattern (PR #16 merged).
- Attendance auto-save removed (PR #17).
- Event validation multi-día + date-overlap (PRs #18, #19).
- `weekKeyOf` → Monday (PR #20, `98a687d`).
- **Refactor lunes (MERGED via PR #21, `fd5cfac`→main)**:
  - logic.js: `mondaysOf`, `weekMondayOf`; `collectPersonAssignments` uses `weekMondayOf`.
  - app.js imports `mondaysOf, weekMondayOf`; `newWeek` sets monday/saturday; `crearProgramasFaltantes` uses mondaysOf; new-month view uses mondaysOf; `meetingDatesForYear`/`commemWeekendFor` lunes; dashboard `findCurrentFinWeek`/`currentGeneralWeek` use monday; 4 inline `weekSunday` defs replaced with `weekKeyOf`; `finWeekAssign`/`finWeekAssignDetail`/`previewTabla`/`programaExportSvg` `aseoGroupFor` use monday; `atencionSemana`/`grupoSemana`/`salidaSemana` lookups use `wmon`; `aplicarRotacionAseos` uses monday; atencion/salidas/aseo generation use mondaysOf; global `aseoGroupFor`/`salidasFor`/`laboresWeekFor` use monday; `wmon` helper added; atencion tab + general view + laboresExportSvg scoped to `cur` month (removed buggy `startsWith(cur)` key filter that hid weeks whose Monday spills into prior month); `aseoWeeksForMonth` uses mondaysOf.
  - db.js: added `addDays` import, DB_VERSION=12, migration v11→v12 adds `monday`/`sunday` to all weeks.
  - sync.js: imports `addDays`; `desplegarPrograma` sets `monday` on pulled weeks.
  - tests: integration schema test v11→v12; E2E DB-open versions 11→12.
  - Tests: 522 unit + 24 integration + 39 E2E = 585 PASS.
### Active
- (none — refactor complete and merged)
### Blocked
- SQL grants `service_role` (Supabase SQL Editor) — pending.
- Deploy `webhook-zapia` — pending.
- `version.json` 404 (sw.js:9, app.js:297) — pending.

## Next Move
1. Commit the refactor on `refactor/semana-lunes`, push, open PR, merge.
2. (Optional) Update `supabase/schema.sql` only if a structural week-key change is needed (not required — `fecha` stays Saturday).

## Relevant Files
- `app.js` – weekKeyOf (816), wmon (~822), newWeek (10312), crearProgramasFaltantes (3018), meetingDatesForYear (823), currentGeneralWeek (2404), finWeekAssign (2449), renderAtencion (7918), general-view grouping (8468), laboresExportSvg (10221), aseoWeeksForMonth (10463), imports (7-28).
- `logic.js` – mondaysOf, weekMondayOf, saturdaysOf (kept), collectPersonAssignments (1589).
- `db.js` – addDays import, DB_VERSION=12, migration v12.
- `sync.js` – addDays import, desplegarPrograma monday.
- `tests-integration.mjs` – schema v12 test.
- `tests/e2e/app.spec.mjs` – DB-open versions → 12.
