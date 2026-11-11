// Quản lý Docker trên LINUX01 (kiểu Portainer) qua SSH, dùng lại LINUX_SSH_* trong .env. User SSH phải thuộc nhóm docker.
// Mọi lệnh đều dựng từ danh sách cố định + tham số đã kiểm tra (regex) + bọc dấu nháy, không nối chuỗi người dùng vào shell.
const express = require('express'); const router = express.Router(); const { Client } = require('ssh2'); const e = process.env;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/, REF = /^[A-Za-z0-9][A-Za-z0-9._\-\/:@]{0,250}$/;
const PROTECTED = new RegExp(e.DOCKER_PROTECTED || 'zabbix|wazuh|portainer|single-node', 'i');   // container/stack hệ thống: chỉ Super-Admin được dừng, khởi động lại, kill, xóa
const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const isSuper = req => req.session.user.role === 'Super-Admin';

// ---- Kết nối SSH dùng lại (tự nối lại khi rớt) ----
let conn = null, connecting = null, runner = null;
function getConn() {
    if (conn) return Promise.resolve(conn); if (connecting) return connecting;
    connecting = new Promise((resolve, reject) => {
        const c = new Client();
        c.on('ready', () => { conn = c; connecting = null; resolve(c); })
         .on('error', err => { if (conn === c) conn = null; connecting = null; reject(err); })
         .on('close', () => { if (conn === c) conn = null; })
         .connect({ host: e.LINUX_SSH_HOST, port: +e.LINUX_SSH_PORT || 22, username: e.LINUX_SSH_USER, password: e.LINUX_SSH_PASS, readyTimeout: 8000, keepaliveInterval: 15000 });
    });
    return connecting;
}
function sh(cmd, timeout = 30000) {
    if (runner) return runner(cmd);
    return getConn().then(c => new Promise((resolve, reject) => c.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        let out = '', er = '', done = false;
        const t = setTimeout(() => { if (!done) { done = true; try { stream.close(); } catch (x) {} reject(new Error('Lệnh docker quá thời gian chờ')); } }, timeout);
        stream.on('data', d => { out += d; if (out.length > 4e6) out = out.slice(-4e6); }); stream.stderr.on('data', d => { er += d; });
        stream.on('close', code => { if (done) return; done = true; clearTimeout(t); resolve({ out, err: er.trim(), code }); });
    })));
}
async function dk(args, timeout) {
    const r = await sh('docker ' + args, timeout);
    if (r.code !== 0) throw new Error((r.err || r.out || 'docker trả về lỗi').split('\n').filter(Boolean).slice(-1)[0].slice(0, 300));
    return r.out;
}
async function shellChecked(command, timeout = 30000) {
    const r = await sh(command, timeout);
    if (r.code !== 0) throw new Error((r.err || r.out || 'Lệnh hệ thống thất bại').split('\n').filter(Boolean).slice(-1)[0].slice(0, 500));
    return r.out;
}
const jl = t => String(t).split('\n').map(l => l.trim()).filter(Boolean).map(l => { try { return JSON.parse(l); } catch (x) { return null; } }).filter(Boolean);
const friendly = x => /authentication methods failed/i.test(x.message) ? 'SSH tới LINUX01 bị từ chối - kiểm tra LINUX_SSH_USER/LINUX_SSH_PASS trong .env' : /permission denied/i.test(x.message) ? 'User SSH chưa có quyền dùng docker - thêm vào nhóm docker: sudo usermod -aG docker <user>' : x.message;
const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (x) { res.json({ success: false, error: friendly(x) }); } };
const bad = res => res.json({ success: false, error: 'Yêu cầu không hợp lệ' });

// ---- Container ----
const parsePorts = s => { const seen = new Set(), out = []; String(s || '').split(',').forEach(p => { const m = /:(\d+)->(\d+)\/(tcp|udp)/.exec(p); if (m && !seen.has(m[1] + m[3])) { seen.add(m[1] + m[3]); out.push({ pub: m[1], priv: m[2], proto: m[3] }); } }); return out; };
async function listContainers() {
    const [ps, stats, ins] = await Promise.all([
        dk("ps -a --no-trunc --format '{{json .}}'"),
        dk("stats --no-stream --format '{{json .}}'", 25000).catch(() => ''),
        sh("docker ps -aq --no-trunc | xargs -r docker inspect --format '{{.Id}}|{{range $k,$v := .NetworkSettings.Networks}}{{$v.IPAddress}} {{end}}|{{.HostConfig.RestartPolicy.Name}}|{{.RestartCount}}'").then(r => r.out).catch(() => '')
    ]);
    const S = jl(stats), I = {}; ins.split('\n').forEach(l => { const [id, ip, rp, rc] = l.split('|'); if (id) I[id] = { ip: (ip || '').trim(), restart: rp || '', restarts: +rc || 0 }; });
    return jl(ps).map(c => {
        const s = S.find(x => x.ID && c.ID.startsWith(x.ID)), name = String(c.Names || '').split(',')[0], stack = (/(?:^|,)com\.docker\.compose\.project=([^,]+)/.exec(c.Labels || '') || [])[1] || '';
        return { id: c.ID, short: c.ID.slice(0, 12), name, image: c.Image, state: c.State, status: c.Status, health: (/\((healthy|unhealthy|health: starting)\)/.exec(c.Status || '') || [])[1] || '', stack, created: String(c.CreatedAt || '').slice(0, 19), ports: parsePorts(c.Ports), ip: (I[c.ID] || {}).ip || '', restart: (I[c.ID] || {}).restart || '', restarts: (I[c.ID] || {}).restarts || 0, cpu: s ? s.CPUPerc : '', mem: s ? s.MemUsage : '', memPerc: s ? s.MemPerc : '', protected: PROTECTED.test(name) || PROTECTED.test(stack) };
    }).sort((a, b) => a.name.localeCompare(b.name));
}
router.get('/containers', wrap(async (req, res) => res.json({ host: e.LINUX_SSH_HOST, containers: await listContainers() })));

const ACTIONS = { start: 'start', stop: 'stop', restart: 'restart', pause: 'pause', unpause: 'unpause', kill: 'kill', remove: 'rm' };
router.post('/containers/:id/:action', wrap(async (req, res) => {
    const { id, action } = req.params, cmd = ACTIONS[action]; if (!ID.test(id) || !cmd) return bad(res);
    if (['kill','remove'].includes(action) && !isSuper(req)) return res.status(403).json({success:false,error:'Kill/Remove chỉ dành cho Super-Admin'});
    const nm = (await dk(`inspect --format '{{.Name}}|{{index .Config.Labels "com.docker.compose.project"}}' ${q(id)}`)).trim().replace(/^\//, '');
    if (PROTECTED.test(nm) && !isSuper(req)) return res.status(403).json({ success: false, error: 'Container hệ thống: mọi thao tác thay đổi trạng thái chỉ dành cho Super-Admin' });
    const flags = action === 'remove' ? (req.body.force ? '-f ' : '') + (req.body.volumes ? '-v ' : '') : '';
    await dk(`${cmd} ${flags}${q(id)}`, 60000); res.json({ success: true, name: nm.split('|')[0] });
}));
router.get('/containers/:id/logs', wrap(async (req, res) => {
    if (!ID.test(req.params.id)) return bad(res);
    const tail = Math.min(Math.max(+req.query.tail || 200, 10), 2000), r = await sh(`docker logs --tail ${tail} --timestamps ${q(req.params.id)} 2>&1 | tail -c 400000`, 30000);
    res.json({ log: r.out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') });
}));
router.get('/containers/:id/inspect', wrap(async (req, res) => {
    if (!ID.test(req.params.id)) return bad(res);
    const j = JSON.parse(await dk(`inspect ${q(req.params.id)}`))[0], reveal = req.query.reveal === '1' && isSuper(req), mask = /PASS|PWD|SECRET|TOKEN|KEY|CREDENTIAL/i, st = j.State || {}, hc = j.HostConfig || {};
    res.json({ name: String(j.Name).replace(/^\//, ''), image: (j.Config || {}).Image, created: j.Created, cmd: [].concat((j.Config || {}).Entrypoint || [], (j.Config || {}).Cmd || []).join(' '),
        state: { status: st.Status, started: st.StartedAt, finished: st.FinishedAt, exitCode: st.ExitCode, oom: st.OOMKilled, health: st.Health && st.Health.Status, restarts: j.RestartCount },
        restart: (hc.RestartPolicy || {}).Name, privileged: !!hc.Privileged, revealed: reveal,
        env: ((j.Config || {}).Env || []).map(x => { const i = x.indexOf('='), k = x.slice(0, i), v = x.slice(i + 1); return { k, v: reveal || !mask.test(k) ? v : '••••••' }; }),
        mounts: (j.Mounts || []).map(m => ({ type: m.Type, src: m.Source || m.Name, dst: m.Destination, rw: m.RW })),
        networks: Object.entries((j.NetworkSettings || {}).Networks || {}).map(([n, v]) => ({ name: n, ip: v.IPAddress, gw: v.Gateway, mac: v.MacAddress })) });
}));

// ---- Tổng quan ----
router.get('/info', wrap(async (req, res) => {
    const [info, df] = await Promise.all([dk("info --format '{{json .}}'"), dk("system df --format '{{json .}}'").catch(() => '')]), i = JSON.parse(info.trim());
    res.json({ host: e.LINUX_SSH_HOST, version: i.ServerVersion, os: i.OperatingSystem, kernel: i.KernelVersion, arch: i.Architecture, cpus: i.NCPU, mem: i.MemTotal, name: i.Name, root: i.DockerRootDir,
        containers: i.Containers, running: i.ContainersRunning, paused: i.ContainersPaused, stopped: i.ContainersStopped, images: i.Images, df: jl(df).map(x => ({ type: x.Type, total: x.TotalCount, active: x.Active, size: x.Size, reclaimable: x.Reclaimable })) });
}));

// ---- Stack (nhóm compose) ----
router.get('/stacks', wrap(async (req, res) => {
    const by = {}; (await listContainers()).forEach(c => { if (!c.stack) return; const s = by[c.stack] = by[c.stack] || { name: c.stack, total: 0, running: 0, protected: PROTECTED.test(c.stack) }; s.total++; if (c.state === 'running') s.running++; });
    res.json({ stacks: Object.values(by).sort((a, b) => a.name.localeCompare(b.name)) });
}));
router.post('/stacks/:name/:action', wrap(async (req, res) => {
    const { name, action } = req.params; if (!ID.test(name) || !['start', 'stop', 'restart'].includes(action)) return bad(res);
    if (PROTECTED.test(name) && !isSuper(req)) return res.status(403).json({ success: false, error: 'Stack hệ thống: thao tác chỉ dành cho Super-Admin' });
    const ids = (await dk(`ps -aq --no-trunc --filter ${q('label=com.docker.compose.project=' + name)}`)).split('\n').map(x => x.trim()).filter(Boolean);
    if (!ids.length) return res.json({ success: false, error: 'Không có container nào trong stack này' });
    await dk(`${action} ${ids.map(q).join(' ')}`, 180000); res.json({ success: true, count: ids.length });
}));

// ---- Image ----
router.get('/images', wrap(async (req, res) => {
    const [im, used] = await Promise.all([dk("images --no-trunc --format '{{json .}}'"), dk("ps -a --format '{{.Image}}'").catch(() => '')]), U = new Set(used.split('\n').map(x => x.trim()).filter(Boolean));
    res.json({ images: jl(im).map(i => ({ id: i.ID, short: String(i.ID).replace('sha256:', '').slice(0, 12), repo: i.Repository, tag: i.Tag, size: i.Size, created: i.CreatedSince, used: U.has(i.Repository) || U.has(i.Repository + ':' + i.Tag) || [...U].some(x => String(i.ID).includes(x.replace('sha256:', ''))) })) });
}));
router.post('/images/pull', wrap(async (req, res) => {
    const ref = String(req.body.image || '').trim(); if (!REF.test(ref)) return bad(res);
    const out = await dk(`pull ${q(ref)}`, 600000); res.json({ success: true, log: out.trim().split('\n').slice(-2).join('\n') });
}));
router.post('/images/remove', wrap(async (req, res) => { if (!isSuper(req)) return res.status(403).json({success:false,error:'Chỉ Super-Admin được xóa image'}); const id = String(req.body.id || ''); if (!/^(sha256:)?[a-f0-9]{12,64}$/.test(id)) return bad(res); await dk(`rmi ${q(id)}`, 60000); res.json({ success: true }); }));
router.post('/images/prune', wrap(async (req, res) => { if (!isSuper(req)) return res.status(403).json({success:false,error:'Chỉ Super-Admin được dọn image'}); const out = await dk('image prune -f', 120000); res.json({ success: true, log: out.trim().split('\n').slice(-1)[0] }); }));

// ---- Volume / Network ----
router.get('/volumes', wrap(async (req, res) => {
    const [vs, mt] = await Promise.all([dk("volume ls --format '{{json .}}'"), dk("ps -a --format '{{.Mounts}}'").catch(() => '')]), U = new Set(mt.split('\n').join(',').split(',').map(x => x.trim()).filter(Boolean));
    res.json({ volumes: jl(vs).map(v => ({ name: v.Name, driver: v.Driver, used: U.has(v.Name) })) });
}));
router.post('/volumes/remove', wrap(async (req, res) => { if (!isSuper(req)) return res.status(403).json({success:false,error:'Chỉ Super-Admin được xóa volume'}); const n = String(req.body.name || ''); if (!ID.test(n)) return bad(res); const used = await dk("ps -a --format '{{.Mounts}}'"); if (used.split(/[,\s]+/).includes(n)) return res.status(409).json({success:false,error:'Volume có thể đang được sử dụng; hãy kiểm tra container và sao lưu trước khi xóa'}); await dk(`volume rm ${q(n)}`, 60000); res.json({ success: true }); }));
router.post('/volumes/prune', wrap(async (req, res) => {   // xóa MỌI volume không container nào dùng: không hoàn tác được
    if (!isSuper(req)) return res.status(403).json({ success: false, error: 'Chỉ Super-Admin được dọn volume' });
    const out = await dk('volume prune -f', 120000); res.json({ success: true, log: out.trim().split('\n').slice(-1)[0] });
}));
router.get('/networks', wrap(async (req, res) => res.json({ networks: jl(await dk("network ls --format '{{json .}}'")).map(n => ({ id: String(n.ID).slice(0, 12), name: n.Name, driver: n.Driver, scope: n.Scope })) })));
router.post('/networks/create', wrap(async (req, res) => {
    if (!isSuper(req)) return res.status(403).json({success:false,error:'Chỉ Super-Admin được tạo network'});
    const name=String(req.body.name||'').trim(), driver=String(req.body.driver||'bridge');
    if (!ID.test(name) || !['bridge','macvlan'].includes(driver)) return bad(res);
    if(driver==='bridge'){await dk(`network create --driver bridge ${q(name)}`,60000);return res.json({success:true,name,driver});}
    const parent=String(req.body.parent||'').trim(), subnet=String(req.body.subnet||'').trim(), gateway=String(req.body.gateway||'').trim();
    const ip4=/^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
    const cidr=/^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\/(?:[0-9]|[12]\d|3[0-2])$/;
    if(!/^[A-Za-z0-9_.:-]{1,32}$/.test(parent)||!cidr.test(subnet)||(gateway&&!ip4.test(gateway)))return res.status(400).json({success:false,error:'Macvlan cần parent interface hợp lệ, subnet CIDR và gateway IPv4 hợp lệ'});
    const args=['network create','--driver macvlan','--subnet',q(subnet)];if(gateway)args.push('--gateway',q(gateway));args.push('-o',q('parent='+parent),q(name));
    await dk(args.join(' '),60000);res.json({success:true,name,driver});
}));
router.post('/networks/remove', wrap(async (req, res) => {
    if (!isSuper(req)) return res.status(403).json({success:false,error:'Chỉ Super-Admin được xóa network'});
    const name=String(req.body.name||'').trim(); if(!ID.test(name)) return bad(res);
    if(['bridge','host','none'].includes(name)) return res.status(400).json({success:false,error:'Không thể xóa network mặc định'});
    const info=JSON.parse(await dk(`network inspect ${q(name)}`))[0];
    if(info.Containers && Object.keys(info.Containers).length) return res.status(400).json({success:false,error:'Network đang được container sử dụng; hãy tháo container trước'});
    await dk(`network rm ${q(name)}`,60000); res.json({success:true});
}));
router.post('/volumes/create', wrap(async (req, res) => {
    if (!isSuper(req)) return res.status(403).json({success:false,error:'Chỉ Super-Admin được tạo volume'});
    const name=String(req.body.name||'').trim(); if(!ID.test(name)) return bad(res);
    await dk(`volume create ${q(name)}`,60000); res.json({success:true,name});
}));
router.post('/builder/prune', wrap(async (req, res) => {
    if (!isSuper(req)) return res.status(403).json({success:false,error:'Chỉ Super-Admin được dọn Build Cache'});
    if (req.body.confirm !== 'PRUNE_BUILD_CACHE') return res.status(400).json({success:false,error:'Cần xác nhận confirm=PRUNE_BUILD_CACHE'});
    const out=await dk('builder prune -f',180000); res.json({success:true,log:out.trim().split('\n').slice(-3).join('\n')});
}));



// ---- Stack creation and Compose editor (Super-Admin only) ----
const stackSafe = n => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,55}$/.test(String(n || ''));
const unsafeCompose = y => [
  /(^|\n)\s*privileged\s*:\s*true\b/i,
  /(^|\n)\s*network_mode\s*:\s*host\b/i,
  /(^|\n)\s*pid\s*:\s*host\b/i,
  /docker\.sock/i,
  /(^|\n)\s*devices\s*:/i,
  /\/\s*:\s*\//
].some(re => re.test(y));
function superOnly(req,res){ if(!isSuper(req)){res.status(403).json({success:false,error:'Chỉ Super-Admin được thực hiện thao tác này'});return false;} return true; }
function validateRelFile(name) {
  const x=String(name||'').replace(/\\/g,'/');
  return x && x.length <= 180 && !x.startsWith('/') && !x.split('/').some(p => !p || p==='.' || p==='..') && /^[A-Za-z0-9_.@+\-/ ]+$/.test(x);
}
function getSftp() { return getConn().then(c => new Promise((resolve,reject)=>c.sftp((err,sftp)=>err?reject(err):resolve(sftp)))); }
function sftpCall(sftp, method, ...args) { return new Promise((resolve,reject)=>{ const cb=(err,val)=>err?reject(err):resolve(val); sftp[method](...args,cb); }); }
async function sftpEnsureDir(sftp, dir) {
  const parts=String(dir).split('/').filter(Boolean); let cur=String(dir).startsWith('/')?'/':'';
  for(const part of parts){ cur=(cur==='/'?'/':cur?cur+'/':'')+part; try { await sftpCall(sftp,'stat',cur); } catch (_) { try { await sftpCall(sftp,'mkdir',cur); } catch (e) { try { await sftpCall(sftp,'stat',cur); } catch (_) { throw e; } } } }
}
async function sftpWriteFile(remotePath, buffer) {
  const sftp=await getSftp();
  try {
    await sftpEnsureDir(sftp,remotePath.slice(0,remotePath.lastIndexOf('/')));
    await new Promise((resolve,reject)=>{ const ws=sftp.createWriteStream(remotePath,{flags:'w',mode:0o600}); ws.on('error',reject); ws.on('close',resolve); ws.end(buffer); });
  } finally { try{sftp.end();}catch(_){} }
}
async function remoteHome(){ const r=await sh('printf %s "$HOME"'); if(r.code!==0)throw new Error('Không lấy được HOME của tài khoản SSH'); return String(r.out||'').trim(); }
async function composePathForStack(name) {
  const home=await remoteHome();
  const managed=`${home}/royal-it-stacks/${name}/compose.yaml`;
  const exists=await sh(`test -f ${q(managed)} && printf yes || printf no`);
  if(String(exists.out||'').trim()==='yes') return {path:managed,managed:true,home};
  const ids=(await dk(`ps -aq --no-trunc --filter ${q('label=com.docker.compose.project='+name)}`)).split('\n').map(x=>x.trim()).filter(Boolean);
  for(const id of ids.slice(0,3)){
    const r=await sh(`docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' ${q(id)}`);
    const file=String(r.out||'').trim().split(',')[0].trim();
    if(file && file.startsWith(home+'/') && (file.startsWith(home+'/zabbix/') || file.startsWith(home+'/wazuh-docker/single-node/') || file.startsWith(home+'/royal-it-stacks/'))) {
      const ok=await sh(`test -f ${q(file)} && printf yes || printf no`);
      if(String(ok.out||'').trim()==='yes') return {path:file,managed:file.startsWith(home+'/royal-it-stacks/'),home};
    }
  }
  return {path:null,managed:false,home};
}
function decodeComposeBody(body = {}) {
  if (body && body.compose64 !== undefined && body.compose64 !== null) {
    const encoded = String(body.compose64);
    if (encoded.length > 90000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error('Compose64 không hợp lệ hoặc vượt giới hạn 64 KB.');
    }
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error('Compose64 không hợp lệ.');
    return decoded.toString('utf8');
  }
  return typeof body?.compose === 'string' ? body.compose : '';
}
function checkComposeBody(yaml) {
  const body=String(yaml||'');
  if(!body.trim() || Buffer.byteLength(body,'utf8')>65536) return 'Compose YAML bắt buộc và tối đa 64 KB';
  if(unsafeCompose(body)) return 'Compose chứa cấu hình rủi ro bị chặn (privileged, host network/PID, devices, docker.sock hoặc bind root)';
  if(!/^\s*services\s*:/m.test(body)) return 'Compose phải có mục services';
  return '';
}
router.post('/stacks/deploy', wrap(async(req,res)=>{
  if(!superOnly(req,res))return;
  const name=String(req.body.name||'').trim();
  let yaml; try { yaml=decodeComposeBody(req.body); } catch (error) { return res.status(400).json({success:false,error:error.message}); }
  if(!stackSafe(name)) return res.status(400).json({success:false,error:'Tên stack chỉ gồm chữ, số, gạch ngang/gạch dưới; tối đa 56 ký tự'});
  const problem=checkComposeBody(yaml); if(problem)return res.status(400).json({success:false,error:problem});
  if(PROTECTED.test(name))return res.status(400).json({success:false,error:'Tên stack trùng vùng bảo vệ; hãy dùng tên ứng dụng riêng'});
  const home=await remoteHome(), dir=`${home}/royal-it-stacks/${name}`, file=`${dir}/compose.yaml`, stage=`${dir}/.compose-${require('crypto').randomBytes(6).toString('hex')}.yaml`, b64=Buffer.from(yaml,'utf8').toString('base64');
  const cmd=`mkdir -p ${q(dir)} && printf %s ${q(b64)} | base64 -d > ${q(stage)} && docker compose -p ${q(name)} -f ${q(stage)} config >/dev/null && mv ${q(stage)} ${q(file)} && docker compose -p ${q(name)} -f ${q(file)} up -d`;
  const out=await shellChecked(cmd,600000).catch(async err=>{ await sh(`rm -f -- ${q(stage)}`).catch(()=>{}); throw err; }); res.json({success:true,name,managed:true,log:out.trim().split('\n').slice(-12).join('\n')});
}));
router.get('/stacks/:name/detail', wrap(async(req,res)=>{
  if(!superOnly(req,res))return;
  const name=req.params.name;if(!stackSafe(name))return bad(res);
  const target=await composePathForStack(name);
  if(!target.path)return res.status(404).json({success:false,error:'Không tìm được file Compose gốc cho stack này'});
  const compose=await shellChecked(`cat -- ${q(target.path)}`);
  res.json({success:true,name,path:target.path,compose,managed:target.managed,protected:PROTECTED.test(name),editable:isSuper(req) && (target.managed || PROTECTED.test(name))});
}));
router.put('/stacks/:name/compose', wrap(async(req,res)=>{
  if(!superOnly(req,res))return;
  const name=req.params.name;if(!stackSafe(name))return bad(res);
  if(PROTECTED.test(name) && String(req.body.confirmName||'')!==name) return res.status(400).json({success:false,error:'Stack hệ thống: nhập chính xác tên stack để xác nhận cập nhật/redeploy'});
  let yaml; try { yaml=decodeComposeBody(req.body); } catch (error) { return res.status(400).json({success:false,error:error.message}); }
  const problem=checkComposeBody(yaml);if(problem)return res.status(400).json({success:false,error:problem});
  const target=await composePathForStack(name);if(!target.path)return res.status(404).json({success:false,error:'Không tìm được file Compose gốc'});
  if(!target.managed && !PROTECTED.test(name))return res.status(403).json({success:false,error:'Chỉ chỉnh sửa Compose trong thư mục quản lý Royal IT; stack ngoài phạm vi được xem chỉ đọc'});
  const b64=Buffer.from(yaml,'utf8').toString('base64'), stage=`${target.path}.royalit-${require('crypto').randomBytes(6).toString('hex')}.tmp`;
  const cmd=`printf %s ${q(b64)} | base64 -d > ${q(stage)} && docker compose -p ${q(name)} -f ${q(stage)} config >/dev/null && mv ${q(stage)} ${q(target.path)} && docker compose -p ${q(name)} -f ${q(target.path)} up -d`;
  const out=await shellChecked(cmd,600000).catch(async err=>{await sh(`rm -f -- ${q(stage)}`).catch(()=>{});throw err;});res.json({success:true,name,log:out.trim().split('\n').slice(-12).join('\n')});
}));

// ---- Run a container with a constrained form (no privileged mode or host bind mounts) ----
router.post('/containers/create', wrap(async(req,res)=>{
  if(!superOnly(req,res))return;
  const b=req.body||{}, name=String(b.name||'').trim(), image=String(b.image||'').trim(), restart=String(b.restart||'unless-stopped');
  if(!ID.test(name)||!REF.test(image))return bad(res);
  if(!['no','on-failure','always','unless-stopped'].includes(restart))return bad(res);
  const args=['run','-d','--name',q(name),'--restart',q(restart)];
  const ports=Array.isArray(b.ports)?b.ports:[];
  if(ports.length>20)return res.status(400).json({success:false,error:'Tối đa 20 port mapping'});
  for(const p of ports){const m=/^(\d{1,5}):(\d{1,5})(?:\/(tcp|udp))?$/.exec(String(p).trim());if(!m||+m[1]<1||+m[1]>65535||+m[2]<1||+m[2]>65535)return bad(res);args.push('-p',q(`${m[1]}:${m[2]}/${m[3]||'tcp'}`));}
  const env=Array.isArray(b.env)?b.env:[];if(env.length>40)return bad(res);
  for(const pair of env){const k=String(pair.key||'');const v=String(pair.value||'');if(!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)||v.length>2048)return bad(res);args.push('-e',q(`${k}=${v}`));}
  const volumes=Array.isArray(b.volumes)?b.volumes:[];if(volumes.length>20)return bad(res);
  for(const v of volumes){const vol=String(v.name||''),dest=String(v.path||'');if(!ID.test(vol)||!dest.startsWith('/')||dest.includes('..')||/docker\.sock/i.test(dest))return bad(res);args.push('-v',q(`${vol}:${dest}`));}
  if(b.network){const network=String(b.network);if(!ID.test(network))return bad(res);args.push('--network',q(network));}
  args.push(q(image));if(b.command){const c=String(b.command);if(c.length>500)return bad(res);args.push('sh','-lc',q(c));}
  const out=await dk(args.join(' '),600000);res.json({success:true,id:out.trim().slice(0,64),name});
}));

// ---- Build Image from a bounded upload context ----
router.post('/images/build', wrap(async(req,res)=>{
  if(!superOnly(req,res))return;
  const tag=String(req.body.tag||'').trim(), files=Array.isArray(req.body.files)?req.body.files:[];
  if(!/^[a-z0-9][a-z0-9._/-]{0,180}(?::[A-Za-z0-9_.-]+)?$/.test(tag))return bad(res);
  if(!files.length||files.length>80)return res.status(400).json({success:false,error:'Chọn 1–80 file làm build context'});
  let total=0;const decoded=[];
  for(const f of files){if(!validateRelFile(f.path)||!(/^[A-Za-z0-9_.@+\-/ ]+$/.test(String(f.path||''))))return res.status(400).json({success:false,error:'Tên file trong build context không hợp lệ'});const buf=Buffer.from(String(f.content||''),'base64');total+=buf.length;if(buf.length>2*1024*1024||total>6*1024*1024)return res.status(413).json({success:false,error:'Build context giới hạn tổng 6 MB, mỗi file 2 MB'});decoded.push({path:String(f.path).replace(/\\/g,'/'),buf});}
  if(!decoded.some(x=>x.path==='Dockerfile'||x.path.endsWith('/Dockerfile')))return res.status(400).json({success:false,error:'Build context phải chứa Dockerfile'});
  const id=require('crypto').randomBytes(8).toString('hex'), dir=`/tmp/royal-it-build-${id}`;
  const sftp=await getSftp();
  async function mkdirp(remote){const parts=remote.split('/').filter(Boolean);let cur='/';for(const part of parts){cur=cur==='/'?`/${part}`:`${cur}/${part}`;try{await sftpCall(sftp,'stat',cur)}catch(_){await sftpCall(sftp,'mkdir',cur).catch(async e=>{await sftpCall(sftp,'stat',cur).catch(()=>{throw e})})}}}
  try{await mkdirp(dir);for(const f of decoded){const remote=`${dir}/${f.path}`;await mkdirp(remote.slice(0,remote.lastIndexOf('/')));await new Promise((resolve,reject)=>{const ws=sftp.createWriteStream(remote,{flags:'w',mode:0o600});ws.on('error',reject);ws.on('close',resolve);ws.end(f.buf);});}}finally{try{sftp.end()}catch(_){}}
  try{const out=await dk(`build -t ${q(tag)} ${q(dir)}`,600000);res.json({success:true,tag,log:out.trim().split('\n').slice(-30).join('\n')});}finally{await sh(`rm -rf -- ${q(dir)}`).catch(()=>{});}
}));

// ---- File browser: Super-Admin only. Container writes are limited to mounted paths. ----
function validContainerPath(value){const p=String(value||'/').trim();if(p.length>512||!p.startsWith('/')||p.split('/').includes('..')||/[\u0000\r\n]/.test(p))return null;return p.replace(/\/{2,}/g,'/');}
async function inspectMounts(id){if(!ID.test(id))throw new Error('Container không hợp lệ');const j=JSON.parse(await dk(`inspect ${q(id)}`))[0];return (j.Mounts||[]).map(m=>({destination:m.Destination,source:m.Name||m.Source,type:m.Type,rw:!!m.RW}));}
router.get('/containers/:id/files', wrap(async(req,res)=>{
  if(!superOnly(req,res))return;const id=req.params.id;if(!ID.test(id))return bad(res);const p=validContainerPath(req.query.path||'/');if(!p)return bad(res);
  const mounts=await inspectMounts(id);const cmd=`exec ${q(id)} sh -lc ${q(`find ${q(p)} -mindepth 1 -maxdepth 2 -printf '%y|%f|%s|%p\\n' 2>/dev/null | head -300`)}`;const r=await sh('docker '+cmd,30000);if(r.code!==0)return res.status(400).json({success:false,error:(r.err||r.out||'Không đọc được thư mục; image có thể không có sh/find').slice(-500)});
  const files=String(r.out||'').split('\n').filter(Boolean).map(l=>{const [type,name,size,...rest]=l.split('|');return {type:type==='d'?'directory':'file',name,size:+size||0,path:rest.join('|')}});res.json({success:true,path:p,files,mounts,canWrite:mounts.some(m=>m.rw&&(p===m.destination||p.startsWith(m.destination+'/')))});
}));
router.post('/containers/:id/files/read', wrap(async(req,res)=>{
  if(!superOnly(req,res))return;const id=req.params.id,p=validContainerPath(req.body.path);if(!ID.test(id)||!p)return bad(res);if(/^(\/proc|\/sys|\/dev|\/run\/secrets)(\/|$)/.test(p))return res.status(403).json({success:false,error:'Đường dẫn hệ thống nhạy cảm bị chặn'});
  const r=await sh(`docker exec ${q(id)} sh -lc ${q(`test -f ${q(p)} && head -c 262144 ${q(p)}`)}`,30000);if(r.code!==0)return res.status(400).json({success:false,error:'Không đọc được file hoặc file không tồn tại'});const mounts=await inspectMounts(id);const canWrite=mounts.some(m=>m.rw&&(p===m.destination||p.startsWith(m.destination+'/')));res.json({success:true,path:p,content:r.out||'',truncated:(r.out||'').length>=262144,canWrite});
}));
router.post('/containers/:id/files/write', wrap(async(req,res)=>{
  if(!superOnly(req,res))return;const id=req.params.id,p=validContainerPath(req.body.path),content=String(req.body.content64?Buffer.from(String(req.body.content64),'base64').toString('utf8'):(req.body.content||''));if(!ID.test(id)||!p)return bad(res);if(Buffer.byteLength(content,'utf8')>262144)return res.status(413).json({success:false,error:'File giới hạn 256 KB'});if(/^(\/proc|\/sys|\/dev|\/run\/secrets)(\/|$)/.test(p))return res.status(403).json({success:false,error:'Đường dẫn hệ thống nhạy cảm bị chặn'});
  const mounts=await inspectMounts(id);if(!mounts.some(m=>m.rw&&(p===m.destination||p.startsWith(m.destination+'/'))))return res.status(403).json({success:false,error:'Chỉ được sửa file bên trong mount/volume có quyền ghi'});
  const temp=`/tmp/royal-it-file-${require('crypto').randomBytes(8).toString('hex')}`;await sftpWriteFile(temp,Buffer.from(content,'utf8'));
  try { const parent=p.slice(0,p.lastIndexOf('/'))||'/'; await dk(`exec ${q(id)} sh -lc ${q(`mkdir -p ${q(parent)}`)}`,30000); await dk(`cp ${q(temp)} ${q(id+':'+p)}`,30000); } finally { await sh(`rm -f -- ${q(temp)}`).catch(()=>{}); }
  res.json({success:true,path:p});
}));
router.get('/volumes/:name/files', wrap(async(req,res)=>{
  if(!superOnly(req,res))return;const name=req.params.name,p=validContainerPath(req.query.path||'/data');if(!ID.test(name)||!p||!(p==='/data'||p.startsWith('/data/')))return bad(res);
  const exists=await sh("docker image inspect busybox:latest >/dev/null 2>&1 && printf yes || printf no");if(String(exists.out||'').trim()!=='yes')return res.status(409).json({success:false,error:'File Browser volume cần busybox:latest đã có trên LINUX01. Hãy pull image trước bằng thao tác được phê duyệt; Portal không tự kéo image helper.'});
  const r=await sh(`docker run --rm --network none -v ${q(name+':/data:ro')} busybox:latest sh -c ${q(`find ${q(p)} -mindepth 1 -maxdepth 3 -printf '%y|%f|%s|%p\\n' 2>/dev/null | head -300`)}`,30000);if(r.code!==0)return res.status(400).json({success:false,error:r.err||r.out||'Không đọc được volume'});
  res.json({success:true,name,path:p,files:String(r.out||'').split('\n').filter(Boolean).map(l=>{const [type,n,size,...rest]=l.split('|');return {type:type==='d'?'directory':'file',name:n,size:+size||0,path:rest.join('|')}}),readOnly:true});
}));
router.post('/volumes/:name/files/read', wrap(async(req,res)=>{
  if(!superOnly(req,res))return;const name=req.params.name,p=validContainerPath(req.body.path);if(!ID.test(name)||!p||!(p==='/data'||p.startsWith('/data/')))return bad(res);const exists=await sh("docker image inspect busybox:latest >/dev/null 2>&1 && printf yes || printf no");if(String(exists.out||'').trim()!=='yes')return res.status(409).json({success:false,error:'Cần busybox:latest có sẵn trên host'});
  const r=await sh(`docker run --rm --network none -v ${q(name+':/data:ro')} busybox:latest sh -c ${q(`test -f ${q(p)} && head -c 262144 ${q(p)}`)}`,30000);if(r.code!==0)return res.status(400).json({success:false,error:r.err||'Không đọc được file'});res.json({success:true,path:p,content:r.out||'',readOnly:true});
}));
router.post('/volumes/:name/files/write', wrap(async(req,res)=>{
  if(!superOnly(req,res))return;const name=req.params.name,p=validContainerPath(req.body.path),content=String(req.body.content64?Buffer.from(String(req.body.content64),'base64').toString('utf8'):(req.body.content||''));if(!ID.test(name)||!p||!(p==='/data'||p.startsWith('/data/')))return bad(res);if(p==='/data')return res.status(400).json({success:false,error:'Hãy chọn tên file bên trong /data'});if(Buffer.byteLength(content,'utf8')>262144)return res.status(413).json({success:false,error:'File giới hạn 256 KB'});const exists=await sh("docker image inspect busybox:latest >/dev/null 2>&1 && printf yes || printf no");if(String(exists.out||'').trim()!=='yes')return res.status(409).json({success:false,error:'Cần busybox:latest có sẵn trên host'});
  const tempDir=`/tmp/royal-it-volume-edit-${require('crypto').randomBytes(8).toString('hex')}`, temp=`${tempDir}/payload`;await sftpWriteFile(temp,Buffer.from(content,'utf8'));
  try { const parent=p.slice(0,p.lastIndexOf('/'))||'/data';const r=await dk(`run --rm --network none -v ${q(name+':/data')} -v ${q(tempDir+':/in:ro')} busybox:latest sh -c ${q(`mkdir -p ${q(parent)} && cp /in/payload ${q(p)}`)}`,30000);res.json({success:true,path:p}); } finally { await sh(`rm -rf -- ${q(tempDir)}`).catch(()=>{}); }
}));

router._setRunner = f => { runner = f; };
router._decodeComposeBody = decodeComposeBody;
router._checkComposeBody = checkComposeBody;
module.exports = router;
