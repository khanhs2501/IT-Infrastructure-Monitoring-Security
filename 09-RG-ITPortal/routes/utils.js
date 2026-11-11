const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Escape all PowerShell quote delimiters inside a single-quoted literal.
// PowerShell treats typographic quotes (‘ ’ “ ”) as delimiters too; doubling
// only ASCII apostrophes leaves an injection path when text contains U+2019.
const psq = value => String(value ?? '')
    .replace(/'/g, "''")
    .replace(/‘/g, '‘‘')
    .replace(/’/g, '’’')
    .replace(/“/g, '““')
    .replace(/”/g, '””');

function parsePowerShellJson(stdout) {
    const out = String(stdout || '').replace(/^\uFEFF/, '').trim();
    if (!out) return null;
    try { return JSON.parse(out); } catch (_) {}

    // Find balanced JSON values even when harmless console text precedes/follows them.
    // Skip over each valid top-level JSON value so nested objects aren't returned instead.
    let last = null;
    for (let start = 0; start < out.length; start++) {
        if (out[start] !== '{' && out[start] !== '[') continue;
        const stack = [];
        let inString = false, escaped = false, end = -1;
        for (let i = start; i < out.length; i++) {
            const ch = out[i];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
                continue;
            }
            if (ch === '"') { inString = true; continue; }
            if (ch === '{' || ch === '[') stack.push(ch);
            else if (ch === '}' || ch === ']') {
                const open = stack.pop();
                if (!open || (open === '{' && ch !== '}') || (open === '[' && ch !== ']')) { end = -1; break; }
                if (stack.length === 0) { end = i; break; }
            }
        }
        if (end < start) continue;
        try {
            last = JSON.parse(out.slice(start, end + 1));
            start = end;
        } catch (_) {
            // This brace belonged to non-JSON console text; keep scanning.
        }
    }
    if (last !== null) return last;

    // Last-resort line parser for scripts that emit a top-level compact JSON value with a marker.
    const lines = out.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].replace(/^__ROYAL_JSON__/, '').trim();
        try { return JSON.parse(line); } catch (_) {}
    }
    return null;
}

async function runPS(script, timeout = 30000) {
    runPS.lastErr = '';
    const wrapped = [
        '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
        '$OutputEncoding = New-Object System.Text.UTF8Encoding $false',
        "$ErrorActionPreference = 'Stop'",
        "$ProgressPreference = 'SilentlyContinue'",
        'try {',
        String(script || ''),
        "} catch { [Console]::Error.WriteLine((($_.Exception.ToString()) -replace '[\\r\\n]+',' ')); exit 1 }"
    ].join('\r\n');

    // Run the whole script from a short, random temporary .ps1 file. This avoids:
    // 1) Windows' command-line length limit for -EncodedCommand;
    // 2) PowerShell 5.1 parsing a long single-line bootstrap from stdin;
    // 3) truncation/partial execution of multi-line scripts. The file is deleted
    // as soon as the child exits (including errors/timeouts). The BOM keeps UTF-8
    // Vietnamese text correct under Windows PowerShell 5.1.
    let tempDir = '';
    let scriptPath = '';
    try {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-itportal-ps-'));
        scriptPath = path.join(tempDir, 'query.ps1');
        fs.writeFileSync(scriptPath, '\uFEFF' + wrapped, { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
        if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {} }
        runPS.lastErr = `Không tạo được script PowerShell tạm: ${String(err.message || err).split(/\r?\n/)[0].slice(0, 350)}`;
        return null;
    }

    return await new Promise(resolve => {
        let stdout = '', stderr = '', settled = false, timedOut = false;
        const maxOutput = 30 * 1024 * 1024;
        let child;
        let timer;
        const cleanup = () => {
            if (!tempDir) return;
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
            tempDir = '';
        };
        const finish = value => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cleanup();
            resolve(value);
        };
        try {
            child = spawn('powershell.exe', [
                '-NoLogo', '-NoProfile', '-NonInteractive',
                '-ExecutionPolicy', 'Bypass', '-File', scriptPath
            ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (err) {
            runPS.lastErr = String(err.message || err).split(/\r?\n/)[0].slice(0, 500);
            finish(null);
            return;
        }

        timer = setTimeout(() => {
            timedOut = true;
            runPS.lastErr = `PowerShell timed out after ${timeout} ms`;
            try { child.kill(); } catch (_) {}
            finish(null);
        }, timeout);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            stdout += chunk;
            if (stdout.length > maxOutput) stdout = stdout.slice(-maxOutput);
        });
        child.stderr.on('data', chunk => {
            stderr += chunk;
            if (stderr.length > maxOutput) stderr = stderr.slice(-maxOutput);
        });
        child.on('error', err => {
            runPS.lastErr = String(err.message || err).split(/\r?\n/)[0].slice(0, 500);
            finish(null);
        });
        child.on('close', code => {
            if (settled || timedOut) return;
            if (code !== 0) {
                const raw = String(stderr || stdout || `PowerShell exited with code ${code}`).trim();
                runPS.lastErr = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(-2).join(' | ').slice(0, 700);
                console.error('[runPS]', runPS.lastErr);
                finish(null);
                return;
            }
            const result = parsePowerShellJson(stdout);
            if (result === null) {
                const tail = String(stdout || '').trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 350);
                const errTail = String(stderr || '').trim().split(/\r?\n/).slice(-2).join(' | ').slice(0, 350);
                runPS.lastErr = !String(stdout || '').trim() && !String(stderr || '').trim()
                    ? 'PowerShell thoát mã 0 nhưng không có STDOUT. Script không phát JSON; kiểm tra cú pháp script và endpoint.'
                    : `PowerShell không trả JSON hợp lệ.${errTail ? ' STDERR: ' + errTail : ''}${tail ? ' OUTPUT: ' + tail : ''}`;
                runPS.lastErr = runPS.lastErr.slice(0, 900);
                console.error('[runPS]', runPS.lastErr);
                finish(null);
                return;
            }
            if (result && !Array.isArray(result) && typeof result === 'object' && result.Success !== undefined) {
                result.success = result.Success;
                result.error = result.Error;
            }
            finish(result);
        });
    });
}
module.exports = { runPS, psq, parsePowerShellJson };
