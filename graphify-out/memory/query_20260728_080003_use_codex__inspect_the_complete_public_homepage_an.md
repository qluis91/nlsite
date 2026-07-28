---
type: "query"
date: "2026-07-28T08:00:03.306411+00:00"
question: "Use Codex. Inspect the complete public homepage and every existing CMS editor directly. Use Graphify only if an existing graph is available; otherwise inspect the codebase normally.\r\n\r\nImplement Admin CMS Phase 1B: complete the editable fields for every existing homepage panel and ensure all visible public content is controlled through the CMS draft/publish system created in Phase 1A.\r\n\r\nDo not redesign revision history yet. Do not implement the Store hero, category hero, About page, or Social Feed in this phase.\r\n\r\n1. Build a public-to-admin content inventory\r\n\r\nInspect the complete homepage and map every visible or behavior-affecting content value through:\r\n\r\npublic EJS/partials\r\nâ†’ controller/view model\r\nâ†’ CMS service\r\nâ†’ draft snapshot\r\nâ†’ published snapshot\r\nâ†’ admin editor\r\n\r\nCreate an internal implementation inventory of:\r\n- hardcoded public text;\r\n- headings and subtitles;\r\n- descriptions;\r\n- labels;\r\n- button text;\r\n- button URLs;\r\n- social-media URLs;\r\n- images and videos;\r\n- alt text;\r\n- accessibility labels;\r\n- visual badges;\r\n- feature items;\r\n- LogoLoop items;\r\n- carousel entries;\r\n- visibility toggles;\r\n- ordering values;\r\n- panel-specific settings.\r\n\r\nAny visible homepage content that should reasonably be managed by an administrator must have a corresponding editable field.\r\n\r\n2. Panel 1 completeness\r\n\r\nReview all content displayed in Panel 1 and add missing editor controls.\r\n\r\nAt minimum include:\r\n- heading;\r\n- supporting text;\r\n- primary and secondary button labels;\r\n- primary and secondary button URLs;\r\n- external-link behavior where applicable;\r\n- social icon visibility;\r\n- social platform label;\r\n- social profile URL;\r\n- accessible label for each social link;\r\n- social-item ordering;\r\n- associated image/media references;\r\n- alt text;\r\n- any existing badge, eyebrow, status, or decorative text controlled by content.\r\n\r\nThe existing social icons must no longer depend on hardcoded profile URLs in EJS or JavaScript.\r\n\r\nSupported social entries should follow the structure already used by the project when possible. Do not allow administrators to submit arbitrary icon HTML or script content.\r\n\r\n3. Remaining homepage panels\r\n\r\nReview every other homepage panel and add all missing fields required to edit the content already visible publicly.\r\n\r\nThis includes, where present:\r\n- Panel 2;\r\n- Panel 3;\r\n- LogoLoop;\r\n- feature collections;\r\n- carousels;\r\n- calls to action;\r\n- headings;\r\n- descriptions;\r\n- buttons and links;\r\n- media;\r\n- captions;\r\n- alt text;\r\n- active/inactive state;\r\n- ordering;\r\n- panel visibility;\r\n- panel-specific labels.\r\n\r\nDo not invent unrelated features. Expose content that already exists publicly but is not editable, plus obvious accessibility metadata required for that content.\r\n\r\n4. Repeated and collection items\r\n\r\nFor social links, LogoLoop items, carousel items, feature cards, or other repeatable content:\r\n- allow adding items;\r\n- editing items;\r\n- reordering items;\r\n- activating/deactivating items;\r\n- deleting or archiving according to the projectâ€™s existing data model;\r\n- selecting media through the existing media-library workflow;\r\n- preserving stable item IDs during edits and reorder operations.\r\n\r\nAvoid replacing entire collections in ways that unnecessarily destroy IDs, timestamps, or revision relationships.\r\n\r\n5. Draft and publish integration\r\n\r\nAll new fields must use the Phase 1A model:\r\n- edits save only into draft snapshots;\r\n- public pages continue reading published snapshots;\r\n- publishing copies the complete valid draft into published data;\r\n- saving one subsection must not erase fields belonging to another subsection;\r\n- partial forms must merge safely with the current stored draft;\r\n- collection changes must remain scoped to the correct panel;\r\n- cache invalidation occurs only after a successful publish transaction.\r\n\r\nDo not reintroduce mutable shared values between draft and published content.\r\n\r\n6. Validation and URL safety\r\n\r\nAdd server-side validation for all new fields.\r\n\r\nRequirements:\r\n- preserve submitted values after validation errors;\r\n- show inline errors and NinjaAlerts;\r\n- validate URLs;\r\n- allow safe relative internal URLs;\r\n- allow only `http:` and `https:` for external links;\r\n- reject `javascript:`, `data:`, unsafe protocols, malformed URLs, and script-like payloads;\r\n- validate media references against existing media records;\r\n- validate platform identifiers for social links;\r\n- apply reasonable text-length limits;\r\n- prevent unsafe target/rel combinations for external links.\r\n\r\nDo not store arbitrary embed HTML.\r\n\r\n7. Admin editor usability\r\n\r\nOrganize fields into understandable groups inside each panel editor, such as:\r\n- Contenido;\r\n- Botones y enlaces;\r\n- Redes sociales;\r\n- Multimedia;\r\n- Accesibilidad;\r\n- Orden y visibilidad.\r\n\r\nUse the existing admin design system.\r\n\r\nRequirements:\r\n- clear labels;\r\n- short explanatory help text where needed;\r\n- visible required/optional states;\r\n- URL placeholders;\r\n- media previews;\r\n- current selected media information;\r\n- accessible add/remove/reorder controls;\r\n- mobile-friendly editor layout;\r\n- existing Save and Publish controls remain visible and functional;\r\n- editor dirty-state logic must include all newly added fields and repeatable items.\r\n\r\nUse `NinjaAlerts` for successful saves, publications, validation failures, and server errors.\r\n\r\n8. Backward compatibility and migration\r\n\r\nExisting published content must continue rendering after deployment.\r\n\r\nWhen adding new fields:\r\n- make migrations additive and idempotent;\r\n- derive safe defaults from existing hardcoded values or current stored content;\r\n- backfill draft and published snapshots where required;\r\n- do not blank current production content;\r\n- do not duplicate existing collection items;\r\n- register every migration in the existing migration tracker;\r\n- ensure deployment migrations can run safely more than once.\r\n\r\nIf a currently hardcoded value is moved into the CMS, preserve its current public value as the initial published value.\r\n\r\n9. Public rendering\r\n\r\nUpdate public rendering so all newly editable fields come from published CMS snapshots.\r\n\r\nRequirements:\r\n- preserve the current visual design and animations;\r\n- preserve safe fallbacks when optional content is empty;\r\n- do not render empty buttons or social links;\r\n- external links receive safe `rel` behavior;\r\n- media uses existing public URL helpers;\r\n- missing or archived media uses the established fallback behavior;\r\n- no public content may accidentally read draft data.\r\n\r\n10. Tests\r\n\r\nAdd focused tests proving:\r\n- every public homepage content field has an admin-editable source;\r\n- Panel 1 social URLs can be edited;\r\n- social URLs are no longer hardcoded in public templates;\r\n- button labels and destinations can be changed;\r\n- media and alt text can be changed;\r\n- collection items can be added, edited, reordered, activated, and removed safely;\r\n- partial form saves do not erase sibling fields;\r\n- draft changes do not affect public output;\r\n- published changes appear immediately;\r\n- invalid and unsafe URLs are rejected;\r\n- validation failures preserve submitted values and media selections;\r\n- existing production content receives backward-compatible defaults;\r\n- normal users cannot access these editors;\r\n- NinjaAlerts receive the correct result messages;\r\n- no regression occurs in Gallery, Store, authentication, account, uploads, SEO, CSP, or public animations.\r\n\r\nRun:\r\n- focused CMS Panel 1 and homepage-editor tests;\r\n- migration and backward-compatibility tests;\r\n- public-rendering tests;\r\n- the complete serial test suite;\r\n- `git diff --check`;\r\n- JavaScript syntax checks for modified scripts.\r\n\r\nDo not create a commit.\r\nDo not modify existing untracked media artifacts.\r\n\r\nReturn:\r\n1. Completion date and time with timezone\r\n2. Public-to-admin inventory and missing fields found\r\n3. Panel 1 and social-link implementation\r\n4. Fields added to every remaining panel\r\n5. Repeatable-item behavior\r\n6. Draft/publish and partial-merge behavior\r\n7. Validation and security behavior\r\n8. Migration and backward-compatibility behavior\r\n9. Files modified\r\n10. Focused test results\r\n11. Full serial suite result\r\n12. Remaining homepage content that is intentionally not editable, with justification\r\n\r\nPrompt generated: 2026-07-28 01:20 CST"
contributor: "graphify"
outcome: "useful"
source_nodes: ["app.js", "adminPageContentController", "cmsRepeatableService", "publicationService"]
---

# Q: Use Codex. Inspect the complete public homepage and every existing CMS editor directly. Use Graphify only if an existing graph is available; otherwise inspect the codebase normally.

Implement Admin CMS Phase 1B: complete the editable fields for every existing homepage panel and ensure all visible public content is controlled through the CMS draft/publish system created in Phase 1A.

Do not redesign revision history yet. Do not implement the Store hero, category hero, About page, or Social Feed in this phase.

1. Build a public-to-admin content inventory

Inspect the complete homepage and map every visible or behavior-affecting content value through:

public EJS/partials
â†’ controller/view model
â†’ CMS service
â†’ draft snapshot
â†’ published snapshot
â†’ admin editor

Create an internal implementation inventory of:
- hardcoded public text;
- headings and subtitles;
- descriptions;
- labels;
- button text;
- button URLs;
- social-media URLs;
- images and videos;
- alt text;
- accessibility labels;
- visual badges;
- feature items;
- LogoLoop items;
- carousel entries;
- visibility toggles;
- ordering values;
- panel-specific settings.

Any visible homepage content that should reasonably be managed by an administrator must have a corresponding editable field.

2. Panel 1 completeness

Review all content displayed in Panel 1 and add missing editor controls.

At minimum include:
- heading;
- supporting text;
- primary and secondary button labels;
- primary and secondary button URLs;
- external-link behavior where applicable;
- social icon visibility;
- social platform label;
- social profile URL;
- accessible label for each social link;
- social-item ordering;
- associated image/media references;
- alt text;
- any existing badge, eyebrow, status, or decorative text controlled by content.

The existing social icons must no longer depend on hardcoded profile URLs in EJS or JavaScript.

Supported social entries should follow the structure already used by the project when possible. Do not allow administrators to submit arbitrary icon HTML or script content.

3. Remaining homepage panels

Review every other homepage panel and add all missing fields required to edit the content already visible publicly.

This includes, where present:
- Panel 2;
- Panel 3;
- LogoLoop;
- feature collections;
- carousels;
- calls to action;
- headings;
- descriptions;
- buttons and links;
- media;
- captions;
- alt text;
- active/inactive state;
- ordering;
- panel visibility;
- panel-specific labels.

Do not invent unrelated features. Expose content that already exists publicly but is not editable, plus obvious accessibility metadata required for that content.

4. Repeated and collection items

For social links, LogoLoop items, carousel items, feature cards, or other repeatable content:
- allow adding items;
- editing items;
- reordering items;
- activating/deactivating items;
- deleting or archiving according to the projectâ€™s existing data model;
- selecting media through the existing media-library workflow;
- preserving stable item IDs during edits and reorder operations.

Avoid replacing entire collections in ways that unnecessarily destroy IDs, timestamps, or revision relationships.

5. Draft and publish integration

All new fields must use the Phase 1A model:
- edits save only into draft snapshots;
- public pages continue reading published snapshots;
- publishing copies the complete valid draft into published data;
- saving one subsection must not erase fields belonging to another subsection;
- partial forms must merge safely with the current stored draft;
- collection changes must remain scoped to the correct panel;
- cache invalidation occurs only after a successful publish transaction.

Do not reintroduce mutable shared values between draft and published content.

6. Validation and URL safety

Add server-side validation for all new fields.

Requirements:
- preserve submitted values after validation errors;
- show inline errors and NinjaAlerts;
- validate URLs;
- allow safe relative internal URLs;
- allow only `http:` and `https:` for external links;
- reject `javascript:`, `data:`, unsafe protocols, malformed URLs, and script-like payloads;
- validate media references against existing media records;
- validate platform identifiers for social links;
- apply reasonable text-length limits;
- prevent unsafe target/rel combinations for external links.

Do not store arbitrary embed HTML.

7. Admin editor usability

Organize fields into understandable groups inside each panel editor, such as:
- Contenido;
- Botones y enlaces;
- Redes sociales;
- Multimedia;
- Accesibilidad;
- Orden y visibilidad.

Use the existing admin design system.

Requirements:
- clear labels;
- short explanatory help text where needed;
- visible required/optional states;
- URL placeholders;
- media previews;
- current selected media information;
- accessible add/remove/reorder controls;
- mobile-friendly editor layout;
- existing Save and Publish controls remain visible and functional;
- editor dirty-state logic must include all newly added fields and repeatable items.

Use `NinjaAlerts` for successful saves, publications, validation failures, and server errors.

8. Backward compatibility and migration

Existing published content must continue rendering after deployment.

When adding new fields:
- make migrations additive and idempotent;
- derive safe defaults from existing hardcoded values or current stored content;
- backfill draft and published snapshots where required;
- do not blank current production content;
- do not duplicate existing collection items;
- register every migration in the existing migration tracker;
- ensure deployment migrations can run safely more than once.

If a currently hardcoded value is moved into the CMS, preserve its current public value as the initial published value.

9. Public rendering

Update public rendering so all newly editable fields come from published CMS snapshots.

Requirements:
- preserve the current visual design and animations;
- preserve safe fallbacks when optional content is empty;
- do not render empty buttons or social links;
- external links receive safe `rel` behavior;
- media uses existing public URL helpers;
- missing or archived media uses the established fallback behavior;
- no public content may accidentally read draft data.

10. Tests

Add focused tests proving:
- every public homepage content field has an admin-editable source;
- Panel 1 social URLs can be edited;
- social URLs are no longer hardcoded in public templates;
- button labels and destinations can be changed;
- media and alt text can be changed;
- collection items can be added, edited, reordered, activated, and removed safely;
- partial form saves do not erase sibling fields;
- draft changes do not affect public output;
- published changes appear immediately;
- invalid and unsafe URLs are rejected;
- validation failures preserve submitted values and media selections;
- existing production content receives backward-compatible defaults;
- normal users cannot access these editors;
- NinjaAlerts receive the correct result messages;
- no regression occurs in Gallery, Store, authentication, account, uploads, SEO, CSP, or public animations.

Run:
- focused CMS Panel 1 and homepage-editor tests;
- migration and backward-compatibility tests;
- public-rendering tests;
- the complete serial test suite;
- `git diff --check`;
- JavaScript syntax checks for modified scripts.

Do not create a commit.
Do not modify existing untracked media artifacts.

Return:
1. Completion date and time with timezone
2. Public-to-admin inventory and missing fields found
3. Panel 1 and social-link implementation
4. Fields added to every remaining panel
5. Repeatable-item behavior
6. Draft/publish and partial-merge behavior
7. Validation and security behavior
8. Migration and backward-compatibility behavior
9. Files modified
10. Focused test results
11. Full serial suite result
12. Remaining homepage content that is intentionally not editable, with justification

Prompt generated: 2026-07-28 01:20 CST

## Answer

Expanded from original query via vocab: [homepage, panel, hero, content, sections, carousel, feature, logoloop, media, button, published, draft]. Traversal identified the public homepage, admin panel controllers, repeatable CMS service, and centralized publication path. Phase 1B added complete panel metadata, a stable-ID social collection, additive migration/backfill, safe URL/media validation, published-only rendering, atomic panel publication, and focused/full regression coverage. Final serial result: 1406 passed, 0 failed, 0 cancelled, 0 skipped.

## Outcome

- Signal: useful

## Source Nodes

- app.js
- adminPageContentController
- cmsRepeatableService
- publicationService