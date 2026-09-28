/**
 * OutboundRestClient
 * Thin wrapper around sn_ws.RESTMessageV2 that adds retries, correlation
 * IDs and a structured result, and writes one integration log entry per
 * call. The transport and sleeper are injectable so the retry logic can be
 * tested off-platform.
 *
 *   var client = new OutboundRestClient({ restMessage: 'Vendor Ticketing', method: 'create_ticket' });
 *   var res = client.send({ body: {...}, correlationId: current.getValue('number') });
 */
var OutboundRestClient = Class.create();
OutboundRestClient.prototype = {
    initialize: function (opts) {
        this.opts = opts || {};
        this.policy = this.opts.policy || new RestRetryPolicy();
        this.transport = this.opts.transport || this._platformTransport.bind(this);
        this.sleep = this.opts.sleep || function (ms) { gs.sleep(ms); };
        this.logger = this.opts.logger || this._platformLogger;
    },

    send: function (req) {
        var attempt = 0;
        var res;
        var started = new Date().getTime();
        while (true) {
            attempt++;
            res = this.transport(req, attempt);
            var ok = res.status >= 200 && res.status < 300 && !res.errorCode;
            if (ok || !this.policy.shouldRetry(attempt, res.status, res.errorCode)) break;
            this.sleep(this.policy.delayMs(attempt, res.headers && res.headers['Retry-After']));
        }
        var result = {
            ok: res.status >= 200 && res.status < 300 && !res.errorCode,
            status: res.status,
            attempts: attempt,
            body: this._parse(res.body),
            error: res.errorCode ? res.errorMessage : (res.status >= 400 ? 'HTTP ' + res.status : ''),
            correlationId: req.correlationId || '',
            elapsedMs: new Date().getTime() - started
        };
        this.logger(req, result);
        return result;
    },

    _parse: function (body) {
        if (!body) return null;
        try { return JSON.parse(body); } catch (e) { return body; }
    },

    _platformTransport: function (req) {
        var rm = new sn_ws.RESTMessageV2(this.opts.restMessage, this.opts.method);
        rm.setRequestHeader('Content-Type', 'application/json');
        if (req.correlationId) rm.setRequestHeader('X-Correlation-ID', req.correlationId);
        if (this.opts.midServer) rm.setMIDServer(this.opts.midServer);
        if (req.body) rm.setRequestBody(JSON.stringify(req.body));
        rm.setHttpTimeout(this.opts.timeoutMs || 30000);
        var r = rm.execute();
        var headers = {};
        var ra = r.getHeader('Retry-After');
        if (ra) headers['Retry-After'] = ra;
        return {
            status: r.getStatusCode(),
            body: r.getBody(),
            headers: headers,
            errorCode: r.haveError() ? r.getErrorCode() : 0,
            errorMessage: r.haveError() ? r.getErrorMessage() : ''
        };
    },

    _platformLogger: function (req, result) {
        var log = new GlideRecord('x_int_patterns_log');
        log.initialize();
        log.setValue('direction', 'outbound');
        log.setValue('endpoint', this.opts ? this.opts.restMessage + '.' + this.opts.method : '');
        log.setValue('correlation_id', result.correlationId);
        log.setValue('status', result.status);
        log.setValue('attempts', result.attempts);
        log.setValue('success', result.ok);
        log.setValue('error', result.error);
        log.setValue('elapsed_ms', result.elapsedMs);
        log.insert();
    },

    type: 'OutboundRestClient'
};
