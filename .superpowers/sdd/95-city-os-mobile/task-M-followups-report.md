# M-F1..M-F4 mobile follow-ups

Branch feat/mbjb-mobile-followups (base release/mbjb-demo ae42071).

- M-F1 Add evidence: lib/submit-evidence.ts (live), offline-queue.ts (kind 'evidence' replay: upload -> register -> action, attachment_ids persisted), help-api.ts (registerEvidence/runEvidenceAction), ticket-actions.ts (upload_evidence button, needsPhoto/needsGps), ticket.$id.tsx. BFF proxy is a generic passthrough (no path whitelist): added two tests only.
- M-F2 ticket_locked: classifyFailure(status, code) -> 'locked'; entry flagged, evidence kept, later entries for the ticket held; banner offline.locked; Send now = existing flush. Detail shows lock banner and no buttons when is_locked.
- M-F3: MAX_NOTE_LENGTH 4000 (maxLength + counter), MAX_QUERY_LENGTH 200 (input + query builder).
- M-F4: re-enabled To accept default for handling_staff via probe (state=dispatch), fallback to Mine when empty/failed/offline/pending.
- Tests: PWA 272 + new = see PR; BFF 91 passed.

## Review fix round (PR #7)
- I1: MOBILE-02 clicks Mine unconditionally. tickets.tsx uses resolveDefaultView (latch: first settled probe answer is kept; later refetches never flip the view). No DOM test env exists in this repo (vitest runs in node, no jsdom/testing-library), so the probe wiring is covered by tests of the pure resolveDefaultView sequence (pending, non-empty, empty, failed/offline, later refetch, new dispatch) rather than a rendered component.
- I2: picker capped at 10 (Add disabled, bilingual note); register chunked by 10 in registerEvidence and in the offline replay; tests for 11/23.
- I3: City Help's ActionPayload has no client_request_id (only comment, fields, attachment_ids), so the fallback was used: a replayed upload_evidence answered 409 invalid_transition counts as applied when GET /api/v1/events/{uid} shows workflow_state awaiting_evidence; other state -> drop; unreadable -> retry.
- Minors: clampNote and q clamp are code-point safe (clampChars), counter counts code points; typed comment is now sent as `comment` (also on queued entries); live 409 ticket_locked after register queues the entry with its ids, flagged locked.
