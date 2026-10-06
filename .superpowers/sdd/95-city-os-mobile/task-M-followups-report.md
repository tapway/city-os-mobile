# M-F1..M-F4 mobile follow-ups

Branch feat/mbjb-mobile-followups (base release/mbjb-demo ae42071).

- M-F1 Add evidence: lib/submit-evidence.ts (live), offline-queue.ts (kind 'evidence' replay: upload -> register -> action, attachment_ids persisted), help-api.ts (registerEvidence/runEvidenceAction), ticket-actions.ts (upload_evidence button, needsPhoto/needsGps), ticket.$id.tsx. BFF proxy is a generic passthrough (no path whitelist): added two tests only.
- M-F2 ticket_locked: classifyFailure(status, code) -> 'locked'; entry flagged, evidence kept, later entries for the ticket held; banner offline.locked; Send now = existing flush. Detail shows lock banner and no buttons when is_locked.
- M-F3: MAX_NOTE_LENGTH 4000 (maxLength + counter), MAX_QUERY_LENGTH 200 (input + query builder).
- M-F4: re-enabled To accept default for handling_staff via probe (state=dispatch), fallback to Mine when empty/failed/offline/pending.
- Tests: PWA 272 + new = see PR; BFF 91 passed.
