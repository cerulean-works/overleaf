# Community review

The `track-changes` web module connects the existing review panel to CE. Add
`track-changes` to `moduleImportSequence` (the fork's default already does).
The module provides comments, threaded replies, editing/deleting messages,
resolve/reopen, per-user tracking mode, and accepting/rejecting suggestions.
Existing CE users receive the effective entitlement even if an imported user
record contains `features.trackChanges: false`; subscription records are not
rewritten. Existing tracked-edit preferences are preserved. Newly created
projects have history range support enabled.

The review panel uses the existing styling, selection anchors, resolved-thread
list, and realtime transport. Changing comments, suggestions, and thread state
works with both ShareJS and History OT. This module does not change an existing
project's OT engine. Mentions retain their existing rendering; notification
email delivery is outside this module.

## Permissions and consistency

Named, logged-in read-only collaborators can comment. Reviewers can suggest
edits and reject their own suggestions; writers and owners can accept/reject
any suggestions. Reviewers can resolve/delete their own threads, and writers
and owners can resolve/delete any thread. Authors can edit their messages.
Writers can moderate messages. Anonymous and restricted-link sessions cannot
create comment anchors or use the thread APIs.

Review decisions use server-selected changes under the project update lock.
A stale document version returns 409, without applying a partial decision;
wait for synchronization and retry. History OT requests include an exact
snapshot selector (position, length, tracking provenance and text), rather than
a client-authorized operation. Reviewer privilege metadata is set by realtime,
never trusted from the browser. Post-rebase checks preserve other authors'
suggestions before storage or broadcast, including forged undo operations.
A reviewer may need a writer's help when an edit would merge or remove another
author's existing tracked suggestion.

Thread state actions apply document anchors and chat metadata, then broadcast.
Failures remain visible to the caller. Resolve/reopen are retryable; a repeated
delete repairs a chat-service failure even if the first attempt removed the
anchor. Project-wide review ranges merge active documents in docstore with
loaded document-updater state, so unopened files and restarts retain their
review entries.

## Prepare existing projects

Before enabling review for an existing deployment, back up MongoDB and the
application data/history volumes, and arrange a maintenance window with editing
paused. Keep document-updater, docstore and history services running during the
preparation. Do not set `rangesSupportEnabled` with a direct MongoDB update:
projects that already have ranges need a history resync.

The runner defaults to a read-only inventory. From this repository:

```sh
# Inspect every project; no migration is executed.
docker compose exec -T sharelatex bash -lc 'source /etc/container_environment.sh; exec node /overleaf/services/web/scripts/history/prepare_review.mjs --all' > review-before.json

# Run a bounded canary, replacing the 24-character ID.
docker compose exec -T sharelatex bash -lc 'source /etc/container_environment.sh; exec node /overleaf/services/web/scripts/history/prepare_review.mjs --project-id 0123456789abcdef01234567 --apply' > review-canary.json

# After validating the canary, prepare the remaining projects serially.
docker compose exec -T sharelatex bash -lc 'source /etc/container_environment.sh; exec node /overleaf/services/web/scripts/history/prepare_review.mjs --all --apply' > review-prepared.json

# Verify every entry is ready before reopening editing.
docker compose exec -T sharelatex bash -lc 'source /etc/container_environment.sh; exec node /overleaf/services/web/scripts/history/prepare_review.mjs --all' > review-after.json
```

The container commands source the generated service environment so internal API
authentication uses the same credentials as the running services.

The JSON report records each project and its original OT migration stage.
Already-prepared projects are skipped. Projects without ranges use the existing
locked quick preparation; projects with ranges use history flush/resync.
The runner stops on the first failure and exits nonzero; `--continue-on-error`
explicitly permits collecting additional failures. `--report /path/in/container`
can also save the report inside the container. Missing full project history,
failed resync, or an unexpected OT-stage change is a failure, not a successful
migration. Run the command again after repairing that project's reported issue.
No command converts a project from ShareJS to History OT.

For the canary, compare source and compiled output, then test comment/reply,
resolve/reopen, suggested insertion/deletion/replacement, accept/reject, reload,
and a second collaborator session. For rollback, restore the backup before
restarting the previous application image. This module's new project data uses
the existing ranges, messages and rooms formats; it adds no separate comments
collection.

## Validation

```sh
yarn workspace @overleaf/web exec vitest run modules/track-changes/test/unit/src
yarn workspace @overleaf/document-updater exec mocha test/unit/js/ReviewActionManagerTests.js test/unit/js/ReviewerAuthorizationTests.js --exit
yarn workspace @overleaf/real-time exec vitest run --config ./vitest.config.unit.cjs test/unit/js/WebsocketController.test.js
node --test services/web/scripts/history/test/prepare_review.test.mjs
```
