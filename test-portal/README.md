# Test Portal — mock partner Labour Portal

A standalone site that stands in for the real partner Labour Portal
during development. It exists so the Sync Worker (Day 3) can be built and
fully tested — login, create-worker, deactivate-worker — without ever
touching the real Portal until Day 5's single supervised cutover test.

**Deliberately form-based HTML, not a JSON API** — the real Portal has no
official API either, so the automation approach that works against this
mock (login via an HTML form, submit an HTML form to create/remove a
worker) is the same shape of automation Day 3's Sync Worker will need
against the real thing. Building against a JSON API here would test the
wrong thing.

**State is in-memory, not persisted** — restarting this app resets all
test data. That's a feature for a test double, not a bug: every test run
starts clean.

## Running

```
pip install -r requirements.txt
uvicorn main:app --port 8020
```

Demo login: `portaladmin` / `portalpass123` (hardcoded for this mock only
— see Day 3 for how the real Portal's actual credentials get stored, which
will be an encrypted vault, never hardcoded).

## Routes

- `GET /login` — HTML login form
- `POST /login` — authenticates, sets a session cookie
- `GET /workers` — HTML list of all portal-side worker entries (for
  visually confirming sync worked during testing)
- `GET /workers/new` — HTML form to add a worker entry
- `POST /workers/new` — creates an entry
- `POST /workers/{id}/deactivate` — marks an entry inactive (mirrors the
  real Portal's "removed/updated" language from the spec — deactivating
  rather than hard-deleting, since that's the more realistic behavior for
  a real labour registry)
- `GET /logout`
