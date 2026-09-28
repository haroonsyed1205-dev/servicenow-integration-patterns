import io
import json
import unittest
import urllib.error
from email.message import Message

from client.sn_incident_client import IncidentIntakeClient, IntakeError


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def http_error(code, body="{}", retry_after=None):
    hdrs = Message()
    if retry_after:
        hdrs["Retry-After"] = retry_after
    return urllib.error.HTTPError("u", code, "err", hdrs, io.BytesIO(body.encode()))


class ClientTests(unittest.TestCase):
    def make(self, outcomes):
        self.calls, self.sleeps = [], []

        def opener(req, timeout):
            self.calls.append(json.loads(req.data))
            o = outcomes.pop(0)
            if isinstance(o, Exception):
                raise o
            return FakeResponse(json.dumps({"result": o}).encode())

        return IncidentIntakeClient("https://dev1.service-now.com/", "u", "p",
                                    opener=opener, sleep=self.sleeps.append)

    def test_success_builds_payload(self):
        c = self.make([{"action": "create", "number": "INC0010001"}])
        r = c.send_alert("monitoring", "A-1", "Disk full", severity="major",
                         caller_email="ops@example.com")
        self.assertEqual(r["number"], "INC0010001")
        self.assertEqual(self.calls[0]["caller"], {"email": "ops@example.com"})
        self.assertEqual(c.url, "https://dev1.service-now.com/api/x_int_patterns/intake/incident")

    def test_retries_on_503_then_succeeds_with_same_idempotency_key(self):
        c = self.make([http_error(503), http_error(429, retry_after="2"), {"action": "update"}])
        r = c.send_alert("monitoring", "A-2", "CPU high")
        self.assertEqual(r["action"], "update")
        self.assertEqual(len(self.calls), 3)
        self.assertTrue(all(call["source_id"] == "A-2" for call in self.calls))
        self.assertEqual(self.sleeps[1], 2)

    def test_does_not_retry_400(self):
        c = self.make([http_error(400, '{"errors":["title is required"]}')])
        with self.assertRaises(IntakeError) as ctx:
            c.send_alert("monitoring", "A-3", "")
        self.assertEqual(ctx.exception.status, 400)
        self.assertEqual(len(self.calls), 1)

    def test_gives_up_after_max_attempts(self):
        c = self.make([http_error(500)] * 4)
        with self.assertRaises(IntakeError):
            c.send_alert("monitoring", "A-4", "x")
        self.assertEqual(len(self.calls), 4)
        self.assertEqual(len(self.sleeps), 3)


if __name__ == "__main__":
    unittest.main()
