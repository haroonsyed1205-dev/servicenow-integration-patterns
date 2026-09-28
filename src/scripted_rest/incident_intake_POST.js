/**
 * Scripted REST API: Incident Intake
 * API: x_int_patterns/intake    Resource: POST /incident
 * Requires authentication; restrict with an ACL to the integration user role.
 */
(function process(/*RESTAPIRequest*/ request, /*RESTAPIResponse*/ response) {

    var repo = {
        findByCorrelation: function (id) {
            var gr = new GlideRecord('incident');
            gr.addQuery('correlation_id', id);
            gr.orderByDesc('sys_created_on');
            gr.setLimit(1);
            gr.query();
            return gr.next() ? { sys_id: gr.getUniqueValue(), number: gr.getValue('number'),
                state: gr.getValue('state'), impact: gr.getValue('impact'), urgency: gr.getValue('urgency') } : null;
        }
    };

    var body;
    try { body = request.body.data; } catch (e) { body = null; }
    var result = new IncidentIntakeService(repo).process(body);

    if (result.action === 'reject') {
        response.setStatus(400);
        response.setBody({ errors: result.errors });
        return;
    }

    var inc = new GlideRecord('incident');
    if (result.action === 'create') {
        inc.initialize();
        Object.keys(result.fields).forEach(function (f) {
            if (inc.isValidField(f)) inc.setValue(f, result.fields[f]);
        });
        inc.setValue('contact_type', 'integration');
        if (result.reopenedFrom) inc.setValue('work_notes', 'Recurrence of ' + result.reopenedFrom);
        inc.insert();
    } else {
        inc.get(result.sys_id);
        Object.keys(result.fields).forEach(function (f) { inc.setValue(f, result.fields[f]); });
        inc.setValue('work_notes', 'Updated by ' + body.source + ' (' + body.source_id + ')');
        inc.update();
    }

    response.setStatus(result.status);
    response.setBody({ action: result.action, number: inc.getValue('number'), sys_id: inc.getUniqueValue() });

})(request, response);
