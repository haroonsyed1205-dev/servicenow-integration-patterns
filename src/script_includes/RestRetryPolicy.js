/**
 * RestRetryPolicy
 * Decides whether an outbound call should be retried and how long to wait.
 * Exponential backoff with full jitter, honours Retry-After, never retries
 * client errors other than 408/429.
 */
var RestRetryPolicy = Class.create();
RestRetryPolicy.prototype = {
    initialize: function (opts) {
        var o = opts || {};
        this.maxAttempts = o.maxAttempts || 4;
        this.baseMs = o.baseMs || 500;
        this.maxDelayMs = o.maxDelayMs || 30000;
        this.random = o.random || Math.random; // injectable for tests
        this.retryable = o.retryable || [408, 429, 500, 502, 503, 504];
    },

    shouldRetry: function (attempt, status, errorCode) {
        if (attempt >= this.maxAttempts) return false;
        if (errorCode) return true;                 // timeout / connection reset (status 0)
        return this.retryable.indexOf(status) > -1;
    },

    delayMs: function (attempt, retryAfterHeader) {
        if (retryAfterHeader) {
            var secs = parseInt(retryAfterHeader, 10);
            if (!isNaN(secs)) return Math.min(secs * 1000, this.maxDelayMs);
        }
        var cap = Math.min(this.maxDelayMs, this.baseMs * Math.pow(2, attempt - 1));
        return Math.floor(this.random() * cap);
    },

    type: 'RestRetryPolicy'
};
