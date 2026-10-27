'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('../db');
const { createApp } = require('../index');
const { generateLicenseKey, hashLicenseKey, safeEqual, addDays } = require('../apikey');

function request(app, path, { method = 'GET', body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const headers = {};
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (token) headers.authorization = 'Bearer ' + token;
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      }).then(async response => {
        const json = await response.json();
        server.close();
        resolve({ status: response.status, json });
      }).catch(error => { server.close(); reject(error); });
    });
  });
}

test('key generation, hashing, safe comparison and date math', () => {
  const a = generateLicenseKey();
  const b = generateLicenseKey();
  assert.ok(a.startsWith('ak_'));
  assert.notEqual(a, b);
  assert.equal(hashLicenseKey(a).length, 64);
  assert.equal(safeEqual('same', 'same'), true);
  assert.equal(safeEqual('same', 'other'), false);
  assert.equal(addDays(new Date('2026-01-01T00:00:00.000Z'), 1).toISOString(), '2026-01-02T00:00:00.000Z');
});

test('admin create, activation, device limit, revoke and admin auth', async () => {
  const db = new Database(':memory:');
  const token = 'test-admin-token-with-at-least-32-characters';
  const app = createApp({ db, adminToken: token });
  try {
    assert.equal((await request(app, '/api/v1/admin/licenses', { token: 'wrong' })).status, 401);
    const created = await request(app, '/api/v1/admin/licenses', {
      method: 'POST', token, body: { days: 30, deviceLimit: 1, type: 'free' },
    });
    assert.equal(created.status, 201);
    assert.ok(created.json.key);
    const key = created.json.key;
    assert.equal(db.findLicenseByHash(hashLicenseKey(key)).key_hash, hashLicenseKey(key));

    const first = await request(app, '/api/v1/licenses/validate', {
      method: 'POST', body: { key, deviceId: 'device-0001' },
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.valid, true);
    assert.ok(first.json.expiresAt);

    const same = await request(app, '/api/v1/licenses/validate', {
      method: 'POST', body: { key, deviceId: 'device-0001' },
    });
    assert.equal(same.status, 200);

    const second = await request(app, '/api/v1/licenses/validate', {
      method: 'POST', body: { key, deviceId: 'device-0002' },
    });
    assert.equal(second.status, 403);

    const id = created.json.id;
    assert.equal((await request(app, `/api/v1/admin/licenses/${id}/revoke`, {
      method: 'POST', token,
    })).status, 200);
    assert.equal((await request(app, '/api/v1/licenses/validate', {
      method: 'POST', body: { key, deviceId: 'device-0001' },
    })).status, 401);
  } finally {
    db.close();
  }
});

test('rejects invalid input and retires query-string endpoint', async () => {
  const db = new Database(':memory:');
  const app = createApp({ db, adminToken: 'test-admin-token-with-at-least-32-characters' });
  try {
    assert.equal((await request(app, '/api/v1/licenses/validate', {
      method: 'POST', body: { key: 'short', deviceId: 'device-0001' },
    })).status, 400);
    assert.equal((await request(app, '/?key=secret')).status, 410);
  } finally {
    db.close();
  }
});