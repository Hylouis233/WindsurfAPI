import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { configureBindHost } from '../src/auth.js';
import { buildBatchProxyBinding, handleDashboardApi, parseBatchImportLine } from '../src/dashboard/api.js';

const originalDashboardPassword = config.dashboardPassword;
const originalApiKey = config.apiKey;

afterEach(() => {
  config.dashboardPassword = originalDashboardPassword;
  config.apiKey = originalApiKey;
  configureBindHost('0.0.0.0');
});

function fakeRes() {
  return {
    statusCode: 0,
    body: '',
    writeHead(status) { this.statusCode = status; },
    end(chunk) { this.body += chunk ? String(chunk) : ''; },
    json() { return this.body ? JSON.parse(this.body) : null; },
  };
}

describe('dashboard batch import proxy binding', () => {
  it('uses nested result.account.id from processWindsurfLogin output', () => {
    const binding = buildBatchProxyBinding(
      { success: true, account: { id: 'acct_123' } },
      'socks5://user:pass@proxy.example.com:1080'
    );
    assert.equal(binding.accountId, 'acct_123');
    assert.deepEqual(binding.proxy, {
      type: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      username: 'user',
      password: 'pass',
    });
  });

  it('parses pasted email/password/auth-token rows and ignores caption lines', () => {
    const token = 'devin-session-token$eyJhbGciOiJIUzI1NiJ9.payload.sig';
    assert.equal(parseBatchImportLine('第6张'), null);
    assert.deepEqual(
      parseBatchImportLine(`bronwyn.eh.l.enscn.82@gmail.com----Windsurf@2025----${token}`),
      {
        proxy: null,
        email: 'bronwyn.eh.l.enscn.82@gmail.com',
        password: 'Windsurf@2025',
        authToken: token,
      },
    );
  });

  it('batch-import accepts captioned token dumps without hitting upstream login when autoAdd is off', async () => {
    config.dashboardPassword = '';
    config.apiKey = '';
    configureBindHost('127.0.0.1');

    const text = [
      '第6张',
      'bronwyn.eh.l.enscn.82@gmail.com----Windsurf@2025----devin-session-token$one',
      '第7张',
      'ad.riennewl.ang.eg27@gmail.com----Windsurf@2025----devin-session-token$two',
      '第8张',
      'step.hanieufaulk.r24+fbtrq3@gmail.com----Windsurf@2025----devin-session-token$three',
      '第9张',
    ].join('\n');

    const res = fakeRes();
    await handleDashboardApi(
      'POST',
      '/batch-import',
      { text, autoAdd: false },
      { headers: {}, socket: { remoteAddress: '127.0.0.1' } },
      res,
    );

    const body = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(body.total, 3);
    assert.equal(body.successCount, 3);
    assert.equal(body.failCount, 0);
    assert.equal(body.skippedCount, 4);
    assert.deepEqual(body.results.map(r => r.email), [
      'bronwyn.eh.l.enscn.82@gmail.com',
      'ad.riennewl.ang.eg27@gmail.com',
      'step.hanieufaulk.r24+fbtrq3@gmail.com',
    ]);
    assert.equal(body.results[0].apiKey, 'devin-session-token$one');
  });

  it('fails closed for dashboard write APIs without auth on non-localhost binds', async () => {
    config.dashboardPassword = '';
    config.apiKey = '';
    configureBindHost('0.0.0.0');

    const res = fakeRes();
    await handleDashboardApi('DELETE', '/cache', {}, { headers: {} }, res);

    assert.equal(res.statusCode, 401);
    assert.match(res.json().error, /Unauthorized/);
  });

  it('allows unauthenticated dashboard writes only on localhost binds', async () => {
    config.dashboardPassword = '';
    config.apiKey = '';
    configureBindHost('127.0.0.1');

    const res = fakeRes();
    await handleDashboardApi('GET', '/cache', {}, { headers: {} }, res);

    assert.equal(res.statusCode, 200);
  });

  it('accepts dashboard auth headers with timing-safe configured secrets', async () => {
    config.dashboardPassword = 'dash-secret';
    config.apiKey = '';
    configureBindHost('0.0.0.0');

    const res = fakeRes();
    await handleDashboardApi('GET', '/cache', {}, { headers: { 'x-dashboard-password': 'dash-secret' } }, res);

    assert.equal(res.statusCode, 200);
  });
});
