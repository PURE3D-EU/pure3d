# Email draft — publication workflow implementation

**Subject:** PURE3D: Proposal → Alpha Review → Final Review → Publication implemented for local testing

Hi everyone,

I have implemented the publication workflow using the Miro wireframes and comments, adapting the screens to the existing PURE3D application.

## What changed

- **Proposals:** authors can start or resume a proposal from My Work. Drafts autosave across visits. Explicit submission validates the proposal, waits for saves/uploads and locks it while it is reviewed. Submitted proposals remain viewable. ORCIDs are optional on creator credits.
- **Alpha Review:** authors provide review context and submit a saved edition. Reviewers receive private invitations, autosave their answers and explicitly submit an immutable review. Completing a review closes private edition access until another invitation. Editors release anonymous feedback and decide whether to request revisions or continue. At least two active reviewers must submit; all active reviewers must finish before feedback is released. Recommendations and collaboration interest remain private to editors.
- **Response to Alpha feedback:** before Final Review, authors explain the changes made and any recommendations not implemented, with reasons. This statement and additional context have a combined 500-word limit and autosave. Reviewers can read the response alongside the edition.
- **Final Review:** submission checks description, language, licence, creator credits and a saved scene, then locks editing. The questionnaire includes value, user experience, satisfaction with Alpha changes, four publication recommendations, further comments and an explicit named/anonymous attribution choice. Drafts autosave; submitted reviews cannot be changed. Editors can reuse Alpha reviewers with a deadline or invite a replacement with a recorded explanation through the editorial UI.
- **Editorial decisions and revisions:** editors release the completed Final Reviews and either request another round or complete Final Review. Authors can then make final corrections. Reviewer votes do not automatically publish an edition.
- **Publication:** authors confirm rights/permissions for all materials and submit a publication request with an optional comment, up to 500 words. Editing locks again. Editors can publish or return the request for corrections. Publication exposes the released Final Reviews using the chosen attribution; Alpha feedback stays private. Published edition records and team membership are locked against ordinary application edits. The old direct-publish/unpublish shortcuts have been removed or blocked.
- **Notifications:** workflow changes continue to produce in-app notifications. A separate, explicitly enabled email queue has been added, with bounded retries and recorded delivery attempts. Review deadlines can be entered and are shown in My Work.

## Decisions that still need confirmation

1. **Final Review visibility:** the board introduction/comments describe public reviews with optional names, while a confirmation screen still says anonymous. The implementation follows the explicit board comment: released Final Reviews become public when the edition is published, with the reviewer choosing whether their profile name appears. Released earlier rounds are included. Please confirm that timing, scope and attribution policy.
2. **Questionnaire wording:** the detailed Technical/User Experience questions are missing. Provisional prompts are used; these should be replaced once the questions are agreed. Final Review explanations/comments currently use a 150-word limit per response.
3. **Reviewer policy:** the minimum is two, rather than exactly two; every active reviewer must finish. Alpha reviewers are normally reused. Please confirm replacement approval, conflicts-of-interest criteria, and whether additional reviewers are allowed.
4. **Deadlines and reminders:** editors select deadlines; no universal review duration, automatic expiry, reminder schedule or escalation policy has been invented. These remain to be agreed. Direct API assignment creation can still omit a deadline; the editorial UI requests one.
5. **Final decision terminology:** completing Final Review permits final author corrections before requesting publication. A decision requiring another review returns the edition for a new round. Please confirm this interpretation for minor changes, major changes and “do not recommend”; the editor remains responsible for the decision.
6. **Publication completeness and rights:** current mandatory metadata checks cover title, description, language, licence, creator credits and a saved scene. Please confirm any additional required metadata and approve the material-rights declaration. File presence does not prove that a scene is renderable or that permissions are legally sufficient.
7. **Training editions and exceptions:** the board’s suggested training bypass is not implemented. There is no new no-review shortcut. The existing peer-review opt-in still controls the peer-review stamp, but not an alternative publication route. Please confirm the intended policy.
8. **Post-publication changes:** there is no author edit or unpublish shortcut. Corrections, withdrawal, versioning and exceptional administrator changes need a separate agreed policy.
9. **Email delivery:** production SMTP, sender/application URL, wording, recipient policy and operational monitoring must be approved and configured before enabling delivery. Real email sending has not been tested or enabled. Notifications created while email is disabled are not retroactively queued.

## Verification and rollout status

- Svelte/TypeScript checks pass with zero errors and warnings.
- The backend journey covers two-reviewer gating, multiple Alpha/Final rounds, private drafts, submitted-review immutability, access lockout, editorial release, rights confirmation, publication returns, attribution and published-record locks.
- Following the cleanup pass, the full Bun test suite has 190 passes and zero failures. The audit test now checks the current content collection, its canonical schema has been aligned, and an obsolete direct-publication expectation has been corrected.
- Browser checks on isolated synthetic data cover author statement save/reopen and submission, Final Review draft save/reopen and submission, editorial completion, author publication request, editorial publication and anonymous visitor access to named/anonymous published reviews. Desktop and mobile form layouts were inspected; the mobile page has no horizontal overflow. The minimal browser scene fixture fails Voyager schema validation, so this run does not establish 3D-rendering correctness.
- The production build passes. Repository-wide lint/formatting debt remains; upstream Voyager bundles are now correctly excluded rather than treated as application source. The cleanup changes are checked separately, without suppressing application lint rules.
- The schema migration has been applied to the local backend only. No production migration, deployment, real publication or real email delivery has been performed. The workflow implementation is committed locally; the subsequent cleanup remains separate for review.

The workflow is ready for local acceptance testing, not yet a claim of production sign-off. Please review the decisions above before rollout.

Best,
[Name]

---

## Local implementation notes (not part of the email)

- Migration: `POCKETBASE_URL=http://127.0.0.1:60021 bun run migrate:publication`.
- `migrate:publication` shares the additive Alpha migration and preserves existing records. Back up and plan a maintenance window before any separately authorized production migration; multi-collection REST migrations are not atomic.
- New states: `final_accepted`, `publication_requested`.
- New endpoints: `final-progress`, `final-invitations`, `final-decision`, `public-reviews` below `/api/pure3d/editions/{editionId}/`.
- Email worker: `pocketbase/pb_hooks/workflow-email.pb.js`; opt in using `PURE3D_WORKFLOW_EMAIL_ENABLED=true`, enabled PocketBase SMTP and a valid HTTPS application URL. It runs every five minutes, at most 50 queued records per run, at most five attempts. Delivery is not exactly-once: a crash after SMTP delivery but before persisting success can cause a duplicate. No deadline-reminder worker is implemented.
- Browser artifacts: `artifacts/final-review-desktop.png` and `artifacts/final-review-mobile.png`. The desktop artifact visibly includes the synthetic scene-validation error; it must not be presented as successful rendering evidence.
