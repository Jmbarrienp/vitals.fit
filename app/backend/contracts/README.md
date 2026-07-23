# Contracts

`openapi.snapshot.json` is the committed baseline of the API's OpenAPI
document (see [ADR-0003](../../docs/adr/0003-contract-testing-boots-from-dist-not-jest.md)
for how it's generated). `npm run smoke:http-contract` regenerates the
document from a fresh build and diffs it against this file — an added
field, removed field, changed type, changed status code, or changed route
fails the suite.

## Updating it intentionally

When a change to a controller or DTO is meant to change the public contract:

```bash
UPDATE_SNAPSHOT=1 npm run smoke:http-contract
```

Review the resulting diff in your `git diff` before committing it — this file
changing is exactly the signal a reviewer should look at closely; nothing else
in the repo describes the API's public shape this precisely.
