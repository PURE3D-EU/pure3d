# Testing

The maintained suite contains feature-level integrations: invoke a public route loader,
command, or service entry point and assert what a user or operator can observe. Use the real
collaborating application modules. Doubles belong at external service or platform boundaries,
not around the feature's own state, validation, codecs, or workflow.

## Default suite

```sh
bun --no-env-file test src scripts pocketbase
```

Retained journeys cover:

- Public profile loading through the real PocketBase SDK and credit/asset modules, with a
  loopback HTTP backend double, including paginated attribution and missing profiles.
- Card derivative generation with real image processing, files, and manifest readback.
- Membership imports, attribution migration/auditing, and ORCID lookup with external backend
  or identity-provider doubles and real reports. Some also invoke the actual CLI.
- Release dry-run immutability, publication recovery against a GitHub boundary double, and
  execution of the Pages archive verifier against real archives.
- Offline authentication-configuration CLI behavior and credential-safe failures.

These tests do not publish releases, migrate production data, or use application credentials.
They do not need Docker Compose. The native backend tests below are discovered but skipped
unless an explicit binary is supplied.

CI supplies the official PocketBase 0.40.3 Linux binary through
`.github/actions/setup-pocketbase`, verifies its pinned SHA-256 checksum and exports
`PB_TEST_BINARY` before both pull-request checks and automatic release checks. Those jobs must
execute the real backend journeys, not rely on the default suite's native-test skips.

## Real backend journeys

```sh
PB_TEST_BINARY=/absolute/path/to/pocketbase \
  bun --no-env-file test pocketbase/tests
```

Use the compatible official native binary described in [ORCID operations](orcid.md#native-backend-rehearsal).
The suites start disposable loopback PocketBase instances with actual hooks, synthetic
accounts, and temporary databases. They exercise authorization, proposal/review/publication,
identity verification, configuration backup, transactional rollback, and durable feedback
queueing. They do not connect to the configured application backend or send real email.

`pocketbase/tests/open-calls.integration.test.ts` also exercises administrator call creation,
save/reopen, publication and live page references through the real CMS hooks, including draft
privacy, unauthorised writes, stale-save rejection, invalid references, recursive embedding
rejection and prevention of deletion while pages or proposals still reference the call.

For a separate sandbox-issuer rehearsal, set `PB_TEST_ORCID_ENVIRONMENT=sandbox` as well.
Neither issuer fixture is a real ORCID login.

## Deliberate exclusions and limits

Removed suites checked isolated helpers/controllers, validators, parsers, math, exact mock
calls, source text, or configuration/fixture inventories. A JSON stringify/parse is not a
save/reopen journey; a mocked transaction is not proof of persistence or atomicity. Invoking
`make -n` to match recipe text is not proof that the development stack works.

There is no maintained browser journey for editor save/reopen, menu editing, autosave,
search cancellation, or Voyager rendering. Removing their unit/source checks does not make
those features integration-tested. The native backend suite also does not currently cover
menu persistence or storage-dashboard HTTP behavior. Verify affected features directly
when changing them; add a focused public-entry-point regression when warranted, rather than
recreating the deleted helper assertions.

Historical reports elsewhere record checks executed at that time, not the current suite.
