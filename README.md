# ServiceNow Integration Patterns

> Portfolio project: original code with synthetic data. See [DISCLAIMER.md](DISCLAIMER.md).

Reusable REST integration patterns for ServiceNow: an idempotent inbound
Scripted REST API, an outbound REST wrapper with retries and logging, a
declarative payload mapper, and a Python client for the inbound API.

## What's inside
| Path | ServiceNow artifact | What it does |
|---|---|---|
| `src/script_includes/IncidentIntakeService.js` | Script Include | Validates/maps inbound payloads, create-vs-update by `source_id`, no severity downgrade |
| `src/script_includes/PayloadMapper.js` | Script Include | Spec-driven mapping both ways: dotted paths, value maps, defaults, transforms |
| `src/script_includes/OutboundRestClient.js` | Script Include | `RESTMessageV2` wrapper: retries, correlation id, MID Server, integration log |
| `src/script_includes/RestRetryPolicy.js` | Script Include | Backoff with jitter, `Retry-After`, retryable status codes |
| `src/scripted_rest/incident_intake_POST.js` | Scripted REST resource | `POST /api/x_int_patterns/intake/incident` |
| `client/sn_incident_client.py` | — | Python (stdlib only) client with retries |
| `docs/design.md` | — | Flow diagram, retry and logging design, IntegrationHub notes |

## Example
```
POST /api/x_int_patterns/intake/incident
{ "source": "monitoring", "source_id": "ALRT-1001", "title": "Disk usage 95% on db01",
  "severity": "major", "urgency": "high", "service": "Payments DB" }

201 { "action": "create", "number": "INC0010001" }
(same source_id again while open) -> 200 { "action": "update", "number": "INC0010001" }
```

## Run the tests
```
node --test
python -m unittest discover -s client/tests -t .
```

## Status
Logic and client are unit tested; the Scripted REST API and REST Message
are being validated on a Personal Developer Instance.
