---
type: "query"
date: "2026-07-28T20:35:44.041369+00:00"
question: "Use Codex. This is a production-blocking Phase 1A regression. Inspect the current code and deployment migration flow directly. Use Graphify only if an existing graph is available.\r\n\r\nProduction symptom:\r\n\r\nIn `/admin/page/panel-1`, an administrator edits text or CTA labels and presses â€œGuardar cambiosâ€.\r\n\r\nObserved behavior:\r\n- the UI continues showing â€œCambios sin guardarâ€;\r\n- after refreshing, all edited values are lost;\r\n- the editor then shows â€œSin cambiosâ€ with the previous stored values;\r\n- therefore the draft was not persisted, not merely a dirty-state UI issue.\r\n\r\nTreat this as a save failure until proven otherwise.\r\n\r\n1. Reproduce the exact request\r\n\r\nTrace the Panel 1 save flow:\r\n\r\nEJS form\r\nâ†’ submit button/form association\r\nâ†’ request payload\r\nâ†’ CSRF\r\nâ†’ route\r\nâ†’ controller\r\nâ†’ validation\r\nâ†’ service\r\nâ†’ transaction\r\nâ†’ draft snapshot columns\r\nâ†’ redirect or re-render\r\nâ†’ subsequent editor read\r\n\r\nInspect the actual Panel 1 form structure carefully.\r\n\r\nConfirm:\r\n- the bottom â€œGuardar cambiosâ€ button submits the intended form;\r\n- it is not outside the form without a valid `form` attribute;\r\n- nested or split forms are not interfering;\r\n- the action and HTTP method match the registered route;\r\n- all required hidden values are present;\r\n- dynamic/repeatable social fields do not block ordinary Hero saves;\r\n- disabled inputs are not unexpectedly omitted;\r\n- the submit handler does not prevent the request without completing it.\r\n\r\n2. Determine the real failure mode\r\n\r\nAdd or use safe structured diagnostics to identify whether production returns:\r\n- 200;\r\n- 302;\r\n- 400;\r\n- 403;\r\n- 404;\r\n- 409;\r\n- 422;\r\n- 500.\r\n\r\nDo not expose secrets or full submitted content in logs.\r\n\r\nLog only:\r\n- request/correlation ID;\r\n- route;\r\n- authenticated admin ID;\r\n- panel key;\r\n- validation result;\r\n- transaction start/commit/rollback;\r\n- error code and sanitized message;\r\n- migration/schema capability result.\r\n\r\nMake server errors visible through `NinjaAlerts` and inline errors instead of silently leaving the page dirty.\r\n\r\n3. Verify production schema compatibility\r\n\r\nInspect the Phase 1A and Phase 1B migrations and Railway deployment migration runner.\r\n\r\nConfirm that all required draft/published columns and tables exist in production, including the exact names and compatible data types expected by the services.\r\n\r\nThe migration tracker currently reports Phase 1B as migration 17. Verify:\r\n- every earlier required migration is registered;\r\n- migration ordering is correct;\r\n- the deployment script actually invokes migration 17 and its dependencies;\r\n- a migration was not marked successful before all statements completed;\r\n- MariaDB/MySQL compatibility;\r\n- idempotent reruns;\r\n- no local-only schema assumptions.\r\n\r\nAdd a non-destructive schema readiness check that fails deployment/readiness clearly when required CMS columns are missing.\r\n\r\nDo not manually mark a failed migration as completed.\r\n\r\n4. Fix draft persistence\r\n\r\nAfter a valid Panel 1 save:\r\n- persist all current Hero draft values;\r\n- safely merge fields not submitted by split forms;\r\n- retain social collection data;\r\n- do not alter published snapshots;\r\n- commit transaction before reporting success;\r\n- reload the editor from the persisted draft;\r\n- show â€œBorrador guardadoâ€ or â€œSin cambiosâ€;\r\n- clear dirty state only after confirmed server success.\r\n\r\nA failed save must:\r\n- preserve submitted values;\r\n- keep â€œCambios sin guardarâ€ or show â€œErrorâ€;\r\n- show a visible error alert;\r\n- never redirect to old stored values;\r\n- never claim success.\r\n\r\n5. Review redirect and flash behavior\r\n\r\nVerify that:\r\n- success flash is created only after transaction commit;\r\n- failure uses an HTTP error status and preserves the submitted model;\r\n- Post/Redirect/Get occurs only after success;\r\n- flash normalization does not consume or misclassify the error;\r\n- no global middleware overwrites submitted editor state;\r\n- stale cache is not used for admin draft reads.\r\n\r\nAdmin editor reads must bypass public published-content cache.\r\n\r\n6. Inspect all CMS Save buttons\r\n\r\nOnce the Panel 1 root cause is fixed, verify the same save contract for:\r\n- Panel 2;\r\n- Panel 3;\r\n- global settings;\r\n- navbar;\r\n- SEO;\r\n- LogoLoop;\r\n- carousel;\r\n- features;\r\n- all six existing CMS editor forms.\r\n\r\nDo not broaden the feature scope. Fix the shared save infrastructure when the cause is shared.\r\n\r\n7. Automated tests\r\n\r\nAdd a regression test matching the production symptom:\r\n\r\n- load Panel 1 editor;\r\n- submit changed Hero title and CTA labels through the real route;\r\n- assert successful persistence;\r\n- reload editor;\r\n- assert changed draft values remain;\r\n- assert public homepage still shows published values;\r\n- publish;\r\n- assert public homepage now shows the new values.\r\n\r\nAlso test:\r\n- missing required migration/schema produces an explicit readiness or server error;\r\n- failed transaction preserves submitted values;\r\n- failed save never redirects to stale values;\r\n- success state clears dirty tracking only after confirmed persistence;\r\n- ordinary Hero save does not erase social items;\r\n- all other CMS Save forms persist and reload correctly.\r\n\r\nRun:\r\n- focused Panel 1 save/reload tests;\r\n- migration/deployment tests;\r\n- CMS Phase 1A and 1B tests;\r\n- full serial suite;\r\n- `git diff --check`;\r\n- syntax checks.\r\n\r\nDo not create a commit.\r\nDo not modify untracked media artifacts.\r\nDo not continue to Phase 1C until this regression is resolved.\r\n\r\nReturn:\r\n1. Completion date and time with timezone\r\n2. Exact root cause\r\n3. Production HTTP/database failure identified\r\n4. Migration and schema status\r\n5. Save-flow correction\r\n6. Error visibility and data-preservation behavior\r\n7. Other CMS editors inspected\r\n8. Files modified\r\n9. Focused test results\r\n10. Full serial suite result\r\n11. Exact Railway deployment verification steps\r\n\r\nPrompt generated: 2026-07-28 09:39 CST"
contributor: "graphify"
outcome: "useful"
source_nodes: ["savePanel1Draft()", "savePanel2Draft()", "savePanel3Draft()", "migrationTracker.js", "migrate-deploy.js"]
---

# Q: Use Codex. This is a production-blocking Phase 1A regression. Inspect the current code and deployment migration flow directly. Use Graphify only if an existing graph is available.

Production symptom:

In `/admin/page/panel-1`, an administrator edits text or CTA labels and presses â€œGuardar cambiosâ€.

Observed behavior:
- the UI continues showing â€œCambios sin guardarâ€;
- after refreshing, all edited values are lost;
- the editor then shows â€œSin cambiosâ€ with the previous stored values;
- therefore the draft was not persisted, not merely a dirty-state UI issue.

Treat this as a save failure until proven otherwise.

1. Reproduce the exact request

Trace the Panel 1 save flow:

EJS form
â†’ submit button/form association
â†’ request payload
â†’ CSRF
â†’ route
â†’ controller
â†’ validation
â†’ service
â†’ transaction
â†’ draft snapshot columns
â†’ redirect or re-render
â†’ subsequent editor read

Inspect the actual Panel 1 form structure carefully.

Confirm:
- the bottom â€œGuardar cambiosâ€ button submits the intended form;
- it is not outside the form without a valid `form` attribute;
- nested or split forms are not interfering;
- the action and HTTP method match the registered route;
- all required hidden values are present;
- dynamic/repeatable social fields do not block ordinary Hero saves;
- disabled inputs are not unexpectedly omitted;
- the submit handler does not prevent the request without completing it.

2. Determine the real failure mode

Add or use safe structured diagnostics to identify whether production returns:
- 200;
- 302;
- 400;
- 403;
- 404;
- 409;
- 422;
- 500.

Do not expose secrets or full submitted content in logs.

Log only:
- request/correlation ID;
- route;
- authenticated admin ID;
- panel key;
- validation result;
- transaction start/commit/rollback;
- error code and sanitized message;
- migration/schema capability result.

Make server errors visible through `NinjaAlerts` and inline errors instead of silently leaving the page dirty.

3. Verify production schema compatibility

Inspect the Phase 1A and Phase 1B migrations and Railway deployment migration runner.

Confirm that all required draft/published columns and tables exist in production, including the exact names and compatible data types expected by the services.

The migration tracker currently reports Phase 1B as migration 17. Verify:
- every earlier required migration is registered;
- migration ordering is correct;
- the deployment script actually invokes migration 17 and its dependencies;
- a migration was not marked successful before all statements completed;
- MariaDB/MySQL compatibility;
- idempotent reruns;
- no local-only schema assumptions.

Add a non-destructive schema readiness check that fails deployment/readiness clearly when required CMS columns are missing.

Do not manually mark a failed migration as completed.

4. Fix draft persistence

After a valid Panel 1 save:
- persist all current Hero draft values;
- safely merge fields not submitted by split forms;
- retain social collection data;
- do not alter published snapshots;
- commit transaction before reporting success;
- reload the editor from the persisted draft;
- show â€œBorrador guardadoâ€ or â€œSin cambiosâ€;
- clear dirty state only after confirmed server success.

A failed save must:
- preserve submitted values;
- keep â€œCambios sin guardarâ€ or show â€œErrorâ€;
- show a visible error alert;
- never redirect to old stored values;
- never claim success.

5. Review redirect and flash behavior

Verify that:
- success flash is created only after transaction commit;
- failure uses an HTTP error status and preserves the submitted model;
- Post/Redirect/Get occurs only after success;
- flash normalization does not consume or misclassify the error;
- no global middleware overwrites submitted editor state;
- stale cache is not used for admin draft reads.

Admin editor reads must bypass public published-content cache.

6. Inspect all CMS Save buttons

Once the Panel 1 root cause is fixed, verify the same save contract for:
- Panel 2;
- Panel 3;
- global settings;
- navbar;
- SEO;
- LogoLoop;
- carousel;
- features;
- all six existing CMS editor forms.

Do not broaden the feature scope. Fix the shared save infrastructure when the cause is shared.

7. Automated tests

Add a regression test matching the production symptom:

- load Panel 1 editor;
- submit changed Hero title and CTA labels through the real route;
- assert successful persistence;
- reload editor;
- assert changed draft values remain;
- assert public homepage still shows published values;
- publish;
- assert public homepage now shows the new values.

Also test:
- missing required migration/schema produces an explicit readiness or server error;
- failed transaction preserves submitted values;
- failed save never redirects to stale values;
- success state clears dirty tracking only after confirmed persistence;
- ordinary Hero save does not erase social items;
- all other CMS Save forms persist and reload correctly.

Run:
- focused Panel 1 save/reload tests;
- migration/deployment tests;
- CMS Phase 1A and 1B tests;
- full serial suite;
- `git diff --check`;
- syntax checks.

Do not create a commit.
Do not modify untracked media artifacts.
Do not continue to Phase 1C until this regression is resolved.

Return:
1. Completion date and time with timezone
2. Exact root cause
3. Production HTTP/database failure identified
4. Migration and schema status
5. Save-flow correction
6. Error visibility and data-preservation behavior
7. Other CMS editors inspected
8. Files modified
9. Focused test results
10. Full serial suite result
11. Exact Railway deployment verification steps

Prompt generated: 2026-07-28 09:39 CST

## Answer

Expanded from graph vocabulary: [panel, hero, save, draft, form, route, controller, validation, transaction, migration, schema, deploy]. DFS confirmed savePanel1Draft(), savePanel2Draft(), savePanel3Draft(), migrationTracker.js, and migrate-deploy.js as the relevant chain. The existing Phase 1A correction remains intact. Fresh verification passed 41 focused tests and the full serial suite passed 1413/1413 with zero failures, cancellations, or skips; git diff and syntax checks passed, and generated media fixtures were removed.

## Outcome

- Signal: useful

## Source Nodes

- savePanel1Draft()
- savePanel2Draft()
- savePanel3Draft()
- migrationTracker.js
- migrate-deploy.js