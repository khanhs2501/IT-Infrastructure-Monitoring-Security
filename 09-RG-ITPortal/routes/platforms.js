const express = require('express');
const axios = require('axios');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const router = express.Router();

const tcpProbe = (host, port, timeout = 1800) => new Promise(resolve => {
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return resolve({ reachable: false, error: 'Chưa cấu hình host/port' });
  const socket = net.connect({ host, port }); let settled = false;
  const finish = result => { if (settled) return; settled = true; socket.destroy(); resolve(result); };
  socket.setTimeout(timeout); socket.once('connect', () => finish({ reachable: true }));
  socket.once('timeout', () => finish({ reachable: false, error: 'Timeout' }));
  socket.once('error', e => finish({ reachable: false, error: e.code || 'Connection error' }));
});

// AWS Query API using SigV4 and Node built-ins; read-only EC2 inventory + CloudWatch CPU metrics.
const awsEncode = s => encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, value, encoding) => crypto.createHmac('sha256', key).update(value).digest(encoding);
function awsSignedUrl(service, region, params) {
  const access = process.env.AWS_ACCESS_KEY_ID, secret = process.env.AWS_SECRET_ACCESS_KEY, token = process.env.AWS_SESSION_TOKEN;
  const host = `${service}.${region}.amazonaws.com`, now = new Date(), amz = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = amz.slice(0, 8);
  const pairs = Object.entries({ ...params, ...(token ? {} : {}) }).map(([k, v]) => [awsEncode(k), awsEncode(v)]).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const query = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  const headers = `host:${host}\nx-amz-content-sha256:${sha256('')}\nx-amz-date:${amz}\n` + (token ? `x-amz-security-token:${token}\n` : '');
  const signed = 'host;x-amz-content-sha256;x-amz-date' + (token ? ';x-amz-security-token' : '');
  const canonical = `GET\n/\n${query}\n${headers}\n${signed}\n${sha256('')}`;
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${sha256(canonical)}`;
  const kDate = hmac('AWS4' + secret, day), kRegion = hmac(kDate, region), kService = hmac(kRegion, service), kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, toSign, 'hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${access}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  return { url: `https://${host}/?${query}`, headers: { Authorization: authorization, 'X-Amz-Date': amz, 'X-Amz-Content-Sha256': sha256(''), ...(token ? { 'X-Amz-Security-Token': token } : {}) } };
}
async function awsQuery(service, region, params) {
  const signed = awsSignedUrl(service, region, params);
  const r = await axios.get(signed.url, { headers: signed.headers, timeout: 9000, responseType: 'text' });
  return String(r.data || '');
}
const xmlText = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function parseXml(xml) {
  const root = {}, stack = [{ name: '', value: root }], tokens = String(xml).match(/<[^>]+>|[^<]+/g) || [];
  for (const tok of tokens) {
    if (tok.startsWith('<?') || tok.startsWith('<!')) continue;
    if (tok.startsWith('</')) {
      const frame = stack.pop(); if (!frame || stack.length === 0) continue;
      const parent = stack[stack.length - 1].value;
      const value = frame.value && typeof frame.value === 'object' && Object.keys(frame.value).length ? frame.value : xmlText(frame.text || '').trim();
      if (Object.prototype.hasOwnProperty.call(parent, frame.name)) parent[frame.name] = Array.isArray(parent[frame.name]) ? [...parent[frame.name], value] : [parent[frame.name], value];
      else parent[frame.name] = value;
    } else if (tok.startsWith('<')) {
      const m = tok.match(/^<([\w:.-]+)/); if (!m) continue;
      if (/\/>$/.test(tok)) continue;
      stack.push({ name: m[1].split(':').pop(), value: {}, text: '' });
    } else if (stack.length > 1) stack[stack.length - 1].text += tok;
  }
  return root;
}
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];

router.get('/', async (req, res) => {
  const zUrl = process.env.ZABBIX_URL ? (() => { try { const u = new URL(process.env.ZABBIX_URL); return { host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)), protocol: u.protocol }; } catch (e) { return null; } })() : null;
  const idxUrl = process.env.INDEXER_URL ? (() => { try { const u = new URL(process.env.INDEXER_URL); return { host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)), protocol: u.protocol }; } catch (e) { return null; } })() : null;
  const pfHost = process.env.PFSENSE_SSH_HOST, pfPort = Number(process.env.PFSENSE_SSH_PORT || 22);
  const [pfProbe, zProbe, wProbe] = await Promise.all([tcpProbe(pfHost, pfPort), tcpProbe(zUrl?.host, zUrl?.port), tcpProbe(idxUrl?.host, idxUrl?.port)]);
  let kubernetes = { configured: !!(process.env.K8S_API_URL && process.env.K8S_BEARER_TOKEN), reachable: false, error: 'Chưa cấu hình K8S_API_URL và K8S_BEARER_TOKEN', nodes: null, pods: null };
  if (kubernetes.configured) {
    try {
      const base = new URL(process.env.K8S_API_URL);
      if (base.protocol !== 'https:') throw new Error('Kubernetes API phải dùng HTTPS');
      const httpsAgent = new https.Agent({ rejectUnauthorized: process.env.K8S_TLS_REJECT_UNAUTHORIZED !== 'false' });
      const headers = { Authorization: 'Bearer ' + process.env.K8S_BEARER_TOKEN };
      const [ver, nodes, pods] = await Promise.all([
        axios.get(new URL('/version', base).toString(), { headers, httpsAgent, timeout: 5000 }),
        axios.get(new URL('/api/v1/nodes', base).toString(), { headers, httpsAgent, timeout: 7000 }),
        axios.get(new URL('/api/v1/pods?limit=500', base).toString(), { headers, httpsAgent, timeout: 7000 })
      ]);
      const ni = nodes.data.items || [], pi = pods.data.items || [];
      kubernetes = { configured: true, reachable: true, version: ver.data.gitVersion || ver.data.gitCommit || 'Connected', nodes: ni.length, nodesReady: ni.filter(n => (n.status?.conditions || []).some(c => c.type === 'Ready' && c.status === 'True')).length, pods: pi.length, podsNotRunning: pi.filter(p => !['Running', 'Succeeded'].includes(p.status?.phase)).length, sampledAt: new Date().toISOString() };
    } catch (e) { kubernetes = { configured: true, reachable: false, error: e.response?.status ? `Kubernetes API HTTP ${e.response.status}` : (e.message || 'Không kết nối được API'), nodes: null, pods: null }; }
  }

  let cloud = { provider: process.env.CLOUD_PROVIDER || 'none', configured: false, reachable: false, instances: null, error: 'Chưa cấu hình Cloud connector' };
  const region = process.env.AWS_REGION, access = process.env.AWS_ACCESS_KEY_ID, secret = process.env.AWS_SECRET_ACCESS_KEY;
  if (String(process.env.CLOUD_PROVIDER || '').toLowerCase() === 'aws' && region && access && secret) {
    cloud = { provider: 'AWS', region, configured: true, reachable: false, instances: null, running: null, cpuSamples: [], error: 'Đang truy vấn AWS Read-only APIs' };
    try {
      const ec2Xml = await awsQuery('ec2', region, { Action: 'DescribeInstances', Version: '2016-11-15', MaxResults: 100 });
      const doc = parseXml(ec2Xml), response = doc.DescribeInstancesResponse || doc;
      const reservations = arr(response.reservationSet?.item), inst = reservations.flatMap(r => arr(r.instancesSet?.item));
      const instances = inst.map(i => ({ id: i.instanceId, type: i.instanceType, state: i.instanceState?.name || 'unknown', privateIp: i.privateIpAddress || '', publicIp: i.ipAddress || '', launched: i.launchTime || '', name: arr(i.tagSet?.item).find(t => t.key === 'Name')?.value || i.instanceId }));
      cloud.instances = instances.length; cloud.running = instances.filter(i => i.state === 'running').length; cloud.instanceList = instances.slice(0, 30); cloud.moreAvailable = !!response.nextToken; cloud.reachable = true; cloud.error = null;
      // Giới hạn CPU samples: tối đa 5 EC2 đang chạy để tránh tạo nhiều lệnh CloudWatch.
      cloud.cpuSamples = await Promise.all(instances.filter(i => i.state === 'running').slice(0, 5).map(async i => {
        if (!i.id) return { id: i.id, avgCpu: null };
        try {
          const now = new Date(), start = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
          const x = await awsQuery('monitoring', region, { Action: 'GetMetricStatistics', Version: '2010-08-01', Namespace: 'AWS/EC2', MetricName: 'CPUUtilization', StartTime: start, EndTime: now.toISOString(), Period: 300, 'Statistics.member.1': 'Average', 'Dimensions.member.1.Name': 'InstanceId', 'Dimensions.member.1.Value': i.id });
          const parsed = parseXml(x), datapoints = arr((parsed.GetMetricStatisticsResponse || parsed).GetMetricStatisticsResult?.Datapoints?.member), avg = datapoints.map(d => Number(d.Average)).filter(Number.isFinite);
          return { id: i.id, name: i.name, avgCpu: avg.length ? Math.round(avg.reduce((a, b) => a + b, 0) / avg.length * 10) / 10 : null };
        } catch (e) { return { id: i.id, name: i.name, avgCpu: null }; }
      }));
    } catch (e) { cloud.error = e.response?.status ? `AWS API HTTP ${e.response.status} - kiểm tra IAM policy/quyền chỉ-đọc và region` : 'Không gọi được AWS API; kiểm tra region, credential và kết nối.'; }
  } else if (String(process.env.CLOUD_PROVIDER || '').toLowerCase() === 'aws') {
    cloud = { provider: 'AWS', region: region || null, configured: false, reachable: false, instances: null, error: 'Cần AWS_REGION, AWS_ACCESS_KEY_ID và AWS_SECRET_ACCESS_KEY. Chỉ dùng IAM role/credential quyền đọc tối thiểu.' };
  }

  res.json({ generatedAt: new Date().toISOString(), local: [
    { id: 'zabbix', name: 'Zabbix API', configured: !!(zUrl && process.env.ZABBIX_TOKEN), reachable: !!zProbe.reachable, detail: zProbe.reachable ? `TCP ${zUrl.protocol}//${zUrl.host}:${zUrl.port} reachable` : (zProbe.error || 'Chưa cấu hình URL/token') },
    { id: 'wazuh', name: 'Wazuh Indexer', configured: !!(idxUrl && process.env.INDEXER_USER && process.env.INDEXER_PASS), reachable: !!wProbe.reachable, detail: wProbe.reachable ? `TCP ${idxUrl.protocol}//${idxUrl.host}:${idxUrl.port} reachable` : (wProbe.error || 'Chưa cấu hình URL/credential') },
    { id: 'pfsense', name: 'pfSense SSH', configured: !!(pfHost && process.env.PFSENSE_SSH_USER && process.env.PFSENSE_SSH_PASS), reachable: !!pfProbe.reachable, detail: pfProbe.reachable ? `TCP ${pfHost}:${pfPort} reachable` : (pfProbe.error || 'Chưa cấu hình SSH') }
  ], kubernetes, cloud });
});
module.exports = router;
