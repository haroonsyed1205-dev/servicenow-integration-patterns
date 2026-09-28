/**
 * IncidentIntakeService
 * Business logic behind the inbound Scripted REST API. Validates and maps
 * an external alert/ticket payload and decides create vs update, using the
 * source system's ID as an idempotency key so retries from the sender never
 * create duplicates.
 */
var IncidentIntakeService = Class.create();
IncidentIntakeService.SPEC = [
    { from: 'source_id', to: 'correlation_id', required: true, transform: 'trim' },
    { from: 'source', to: 'u_source_system', required: true, transform: 'lower' },
    { from: 'title', to: 'short_description', required: true, transform: ['trim', 'truncate160'] },
    { from: 'details', to: 'description' },
    { from: 'severity', to: 'impact', map: { critical: '1', major: '2', minor: '3' }, 'default': '3', transform: 'lower' },
    { from: 'urgency', to: 'urgency', map: { high: '1', medium: '2', low: '3' }, 'default': '2', transform: 'lower' },
    { from: 'service', to: 'u_service_name', transform: 'trim' },
    { from: 'caller.email', to: 'u_caller_email', transform: ['trim', 'lower'] }
];
IncidentIntakeService.prototype = {
    initialize: function (repo) {
        // repo: { findByCorrelation(id) -> {sys_id, number, state} | null }
        this.repo = repo;
        this.mapper = new PayloadMapper(IncidentIntakeService.SPEC);
    },

    process: function (payload) {
        if (!payload || typeof payload !== 'object') {
            return { status: 400, action: 'reject', errors: ['Body must be a JSON object'] };
        }
        var m = this.mapper.map(payload);
        if (!m.valid) return { status: 400, action: 'reject', errors: m.errors };

        var existing = this.repo.findByCorrelation(m.data.correlation_id);
        if (!existing) return { status: 201, action: 'create', fields: m.data };

        if (existing.state === '7' || existing.state === '8') { // Closed / Canceled
            return { status: 201, action: 'create', fields: m.data, reopenedFrom: existing.number };
        }
        // Updates never downgrade: keep the more severe impact/urgency
        var fields = {};
        ['description', 'impact', 'urgency'].forEach(function (f) {
            if (m.data[f] !== undefined) fields[f] = m.data[f];
        });
        if (existing.impact && fields.impact > existing.impact) fields.impact = existing.impact;
        if (existing.urgency && fields.urgency > existing.urgency) fields.urgency = existing.urgency;
        return { status: 200, action: 'update', sys_id: existing.sys_id, number: existing.number, fields: fields };
    },

    type: 'IncidentIntakeService'
};
