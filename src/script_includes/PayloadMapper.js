/**
 * PayloadMapper
 * Declarative field mapping between an external JSON payload and a
 * ServiceNow record, used in both directions:
 *   spec = [{ from: 'ticket.priority', to: 'urgency', map: {P1:'1',P2:'2'}, required: true }, ...]
 * Supports dotted paths, value maps, defaults and simple transforms.
 */
var PayloadMapper = Class.create();
PayloadMapper.prototype = {
    initialize: function (spec) {
        this.spec = spec || [];
        this.transforms = {
            trim: function (v) { return typeof v === 'string' ? v.trim() : v; },
            upper: function (v) { return typeof v === 'string' ? v.toUpperCase() : v; },
            lower: function (v) { return typeof v === 'string' ? v.toLowerCase() : v; },
            truncate160: function (v) { return typeof v === 'string' ? v.substring(0, 160) : v; }
        };
    },

    get: function (obj, path) {
        return path.split('.').reduce(function (o, k) {
            return o === undefined || o === null ? undefined : o[k];
        }, obj);
    },

    set: function (obj, path, value) {
        var keys = path.split('.');
        var o = obj;
        for (var i = 0; i < keys.length - 1; i++) {
            if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {};
            o = o[keys[i]];
        }
        o[keys[keys.length - 1]] = value;
    },

    map: function (source, reverse) {
        var out = {};
        var errors = [];
        var self = this;
        this.spec.forEach(function (m) {
            var from = reverse ? m.to : m.from;
            var to = reverse ? m.from : m.to;
            var v = self.get(source, from);
            (m.transform ? [].concat(m.transform) : []).forEach(function (t) { v = self.transforms[t](v); });
            if (m.map) {
                var table = reverse ? self._invert(m.map) : m.map;
                if (v !== undefined && v !== '' && table[v] === undefined) {
                    errors.push(from + ': unmapped value "' + v + '"');
                    v = undefined;
                } else if (v !== undefined) {
                    v = table[v];
                }
            }
            if ((v === undefined || v === '') && m['default'] !== undefined) v = m['default'];
            if ((v === undefined || v === '') && m.required && !reverse) {
                errors.push(from + ' is required');
                return;
            }
            if (v !== undefined) self.set(out, to, v);
        });
        return { data: out, errors: errors, valid: errors.length === 0 };
    },

    _invert: function (m) {
        var r = {};
        Object.keys(m).forEach(function (k) { if (r[m[k]] === undefined) r[m[k]] = k; });
        return r;
    },

    type: 'PayloadMapper'
};
