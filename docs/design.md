# Design notes

## Inbound: Incident Intake API
```
Sender --POST /api/x_int_patterns/intake/incident--> Scripted REST resource
            (source_id = idempotency key)                 |
                                              IncidentIntakeService.process()
                                               |  PayloadMapper (validate + map)
                                               |  findByCorrelation(source_id)
                          +--------------------+----------------------+
                     not found               open                 closed/canceled
                     201 create           200 update             201 create (recurrence)
```
- Sender retries are safe: the same `source_id` updates, never duplicates.
- Updates never lower impact or urgency.
- Mapping lives in one spec (`IncidentIntakeService.SPEC`) so adding a field
  is a one-line change.

## Outbound: OutboundRestClient
- Wraps `sn_ws.RESTMessageV2`; optional MID Server for on-prem targets.
- Retries 408/429/5xx and connection errors with exponential backoff and
  jitter; honours `Retry-After`.
- Sends `X-Correlation-ID` (usually the record number) so both sides can
  trace a call.
- Writes one row per call to `x_int_patterns_log` (direction, endpoint,
  correlation id, status, attempts, elapsed ms, error).

Note: `gs.sleep()` inside a synchronous transaction holds a thread. For
production-volume outbound calls, run the client from an async Business Rule,
a Flow Designer action or an event script, never from a before rule.

## IntegrationHub equivalent
The same pattern as a spoke: one REST step per operation, a "Retry policy"
on the connection alias, and a Script step calling `PayloadMapper` for
mapping. Kept as scripts here so the logic is testable in CI.
