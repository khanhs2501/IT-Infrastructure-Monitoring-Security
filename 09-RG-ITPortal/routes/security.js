const express = require('express'); const router = express.Router(); const axios = require('axios'); const https = require('https');
// Lab có thể dùng cert tự ký khi biến đặt false; production phải bật true và cài CA tin cậy.
const agent = new https.Agent({ rejectUnauthorized: process.env.INDEXER_TLS_REJECT_UNAUTHORIZED === 'true' });
const URL = process.env.INDEXER_URL + '/wazuh-alerts-*/_search';
const q = body => axios.post(URL, body, { headers: { Authorization: 'Basic ' + Buffer.from(process.env.INDEXER_USER + ':' + process.env.INDEXER_PASS).toString('base64') }, httpsAgent: agent, timeout: 10000 });
router.get('/wazuh', async (req, res) => {
    try {
        const range = { range: { timestamp: { gte: 'now-24h' } } };
        // Phạm vi ROYAL IT tập trung vào server; CLIENT01 được loại khỏi dashboard bảo mật mặc định.
        const scopeAgents = String(process.env.WAZUH_SCOPE_AGENTS || 'ROYAL01,LINUX01').split(',').map(x => x.trim()).filter(Boolean);
        const scope = { terms: { 'agent.name': scopeAgents } };
        const [a, b] = await Promise.all([
            q({ size: 0, track_total_hits: true, query: { bool: { filter: [range, scope] } }, aggs: { sev: { range: { field: 'rule.level', ranges: [{ key: 'low', to: 7 }, { key: 'medium', from: 7, to: 12 }, { key: 'high', from: 12, to: 15 }, { key: 'critical', from: 15 }] } }, agents: { terms: { field: 'agent.name', size: 20 } } } }),
            q({ size: 150, sort: [{ timestamp: 'desc' }], _source: ['timestamp', 'agent.name', 'rule.id', 'rule.level', 'rule.description'], query: { bool: { filter: [range, scope, { range: { 'rule.level': { gte: 7 } } }] } } })
        ]);
        const sev = {}; a.data.aggregations.sev.buckets.forEach(x => sev[x.key] = x.doc_count);
        res.json({ errors: [], scope: scopeAgents, total: a.data.hits.total.value, sev, agents: a.data.aggregations.agents.buckets.map(x => ({ name: x.key, count: x.doc_count })),
            events: b.data.hits.hits.map(h => { const s = h._source; return { eventId: h._id, time: new Date(s.timestamp).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), agent: s.agent ? s.agent.name : '?', level: s.rule ? s.rule.level : 0, id: s.rule ? s.rule.id : '', desc: s.rule ? s.rule.description : '' }; }) });
    } catch (e) { res.json({ errors: ['Wazuh Indexer: ' + (e.response ? 'HTTP ' + e.response.status + ' (kiểm tra INDEXER_USER/INDEXER_PASS trong .env)' : e.code || e.message)] }); }
});
module.exports = router;


