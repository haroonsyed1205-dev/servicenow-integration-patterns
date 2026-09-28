"""Minimal Python client for the Incident Intake Scripted REST API.

Standard library only. Retries on 429/5xx with exponential backoff and sends
the same source_id on every retry, which the API uses as an idempotency key.

    client = IncidentIntakeClient("https://dev12345.service-now.com",
                                  user="integration.user", password=os.environ["SN_PASSWORD"])
    client.send_alert(source="monitoring", source_id="ALRT-42", title="Disk full on db01",
                      severity="major", urgency="high")
"""
import base64
import json
import random
import time
import urllib.error
import urllib.request

API_PATH = "/api/x_int_patterns/intake/incident"
RETRYABLE = {408, 429, 500, 502, 503, 504}


class IntakeError(Exception):
    def __init__(self, status, body):
        super().__init__(f"HTTP {status}: {body}")
        self.status = status
        self.body = body


class IncidentIntakeClient:
    def __init__(self, instance_url, user, password, max_attempts=4, base_delay=0.5,
                 opener=None, sleep=time.sleep):
        self.url = instance_url.rstrip("/") + API_PATH
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        self.headers = {"Authorization": f"Basic {token}",
                        "Content-Type": "application/json", "Accept": "application/json"}
        self.max_attempts = max_attempts
        self.base_delay = base_delay
        self._open = opener or urllib.request.urlopen
        self._sleep = sleep

    def send_alert(self, source, source_id, title, severity="minor", urgency="medium",
                   details=None, service=None, caller_email=None):
        payload = {"source": source, "source_id": source_id, "title": title,
                   "severity": severity, "urgency": urgency}
        if details:
            payload["details"] = details
        if service:
            payload["service"] = service
        if caller_email:
            payload["caller"] = {"email": caller_email}
        return self._post(payload)

    def _post(self, payload):
        data = json.dumps(payload).encode()
        for attempt in range(1, self.max_attempts + 1):
            req = urllib.request.Request(self.url, data=data, headers=self.headers, method="POST")
            try:
                with self._open(req, timeout=30) as resp:
                    body = json.loads(resp.read().decode() or "{}")
                    return body.get("result", body)
            except urllib.error.HTTPError as e:
                text = e.read().decode(errors="replace")
                if e.code not in RETRYABLE or attempt == self.max_attempts:
                    raise IntakeError(e.code, text) from None
                retry_after = e.headers.get("Retry-After") if e.headers else None
                self._sleep(self._delay(attempt, retry_after))
            except urllib.error.URLError:
                if attempt == self.max_attempts:
                    raise
                self._sleep(self._delay(attempt, None))

    def _delay(self, attempt, retry_after):
        if retry_after and retry_after.isdigit():
            return min(int(retry_after), 30)
        return random.uniform(0, min(30, self.base_delay * 2 ** (attempt - 1)))
