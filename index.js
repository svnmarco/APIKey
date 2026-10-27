'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('./db');
const {
  generateLicenseKey,
  hashLicenseKey,
  safeEqual,
  addDays,
} = require('./apikey');

function createApp({ db = new Database(), adminToken = process.env.ADMIN_TOKEN } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '16kb', strict: true }));

  const validateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many validation requests. Try again later.' },
  });
  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many admin requests. Try again later.' },
  });

  function requireAdmin(req, res, next) {
    if (!adminToken) {
      return res.status(503).json({ error: 'Admin authentication is not configured.' });
    }
    const header = req.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match || !safeEqual(match[1], adminToken)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    return next();
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/api/v1/licenses/validate', validateLimiter, (req, res, next) => {
    try {
      const { key, deviceId } = req.body || {};
      if (typeof key !== 'string' || key.length < 8 || key.length > 256 ||
          typeof deviceId !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(deviceId)) {
        return res.status(400).json({ valid: false, error: 'A valid key and deviceId are required.' });
      }

      const license = db.findLicenseByHash(hashLicenseKey(key));
      if (!license || license.status !== 'active') {
        db.audit('license.validation_denied', null, { reason: 'invalid_or_inactive' });
        return res.status(401).json({ valid: false, error: 'Invalid or inactive license.' });
      }

      const now = new Date();
      let expiresAt = license.expires_at ? new Date(license.expires_at) : null;
      if (expiresAt && expiresAt.getTime() <= now.getTime()) {
        db.audit('license.validation_denied', license.id, { reason: 'expired' });
        return res.status(403).json({ valid: false, error: 'License expired.' });
      }

      const knownDevice = db.hasDevice(license.id, deviceId);
      if (!knownDevice && db.countDevices(license.id) >= license.device_limit) {
        db.audit('license.validation_denied', license.id, { reason: 'device_limit' });
        return res.status(403).json({ valid: false, error: 'Device limit reached.' });
      }

      // First successful validation activates an unactivated license and starts its clock.
      if (!expiresAt) {
        expiresAt = addDays(now, license.days);
      }
      const registered = db.registerDeviceAndActivate(
        license.id, deviceId, expiresAt.toISOString(), now.toISOString(), license.device_limit
      );
      if (!registered) {
        db.audit('license.validation_denied', license.id, { reason: 'device_limit' });
        return res.status(403).json({ valid: false, error: 'Device limit reached.' });
      }
      db.audit('license.validation_succeeded', license.id, { deviceId });
      return res.json({
        valid: true,
        type: license.type,
        expiresAt: expiresAt.toISOString(),
        deviceLimit: license.device_limit,
        registeredDevices: db.countDevices(license.id),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/v1/admin/licenses', adminLimiter, requireAdmin, (req, res, next) => {
    try {
      const { days, deviceLimit, type = 'free' } = req.body || {};
      if (!Number.isInteger(days) || days < 1 || days > 3650 ||
          !Number.isInteger(deviceLimit) || deviceLimit < 1 || deviceLimit > 100 ||
          typeof type !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(type)) {
        return res.status(400).json({
          error: 'days must be 1-3650, deviceLimit must be 1-100, and type must be 1-32 safe characters.',
        });
      }
      const key = generateLicenseKey();
      const created = db.createLicense({
        keyHash: hashLicenseKey(key),
        keyPrefix: key.slice(0, 8),
        type,
        days,
        deviceLimit,
        createdAt: new Date().toISOString(),
      });
      db.audit('license.created', created.id, { type, days, deviceLimit });
      // The plaintext key is returned only once; only its SHA-256 hash is stored.
      return res.status(201).json({
        id: created.id,
        key,
        type,
        days,
        deviceLimit,
        expiresAt: null,
        message: 'Save this key now. It cannot be retrieved later.',
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/v1/admin/licenses', adminLimiter, requireAdmin, (_req, res, next) => {
    try {
      return res.json({ licenses: db.listLicenses() });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/v1/admin/licenses/:id/revoke', adminLimiter, requireAdmin, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid license id.' });
      const changed = db.revokeLicense(id, new Date().toISOString());
      if (!changed) return res.status(404).json({ error: 'License not found.' });
      db.audit('license.revoked', id, {});
      return res.json({ success: true, id, status: 'revoked' });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/v1/admin/licenses/:id/reset-devices', adminLimiter, requireAdmin, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid license id.' });
      if (!db.findLicenseById(id)) return res.status(404).json({ error: 'License not found.' });
      const removed = db.resetDevices(id);
      db.audit('license.devices_reset', id, { removed });
      return res.json({ success: true, id, removedDevices: removed });
    } catch (error) {
      return next(error);
    }
  });

  // Do not accept credentials in query strings: URLs are commonly logged and cached.
  app.all('/', (_req, res) => res.status(410).json({
    error: 'Legacy endpoint retired. Use POST /api/v1/licenses/validate with a JSON body.',
  }));

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((error, _req, res, _next) => {
    // Do not expose SQL errors, tokens, or stack traces to clients.
    console.error('Request failed:', error.message);
    if (res.headersSent) return;
    return res.status(500).json({ error: 'Internal server error.' });
  });

  // Expose only for tests and graceful shutdown.
  app.locals.db = db;
  return app;
}

if (require.main === module) {
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 32) {
    console.error('Set ADMIN_TOKEN to a random secret of at least 32 characters in your environment.');
    process.exit(1);
  }
  const db = new Database();
  const app = createApp({ db, adminToken: process.env.ADMIN_TOKEN });
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => console.log(`APIKey license server listening on port ${port}`));
  const shutdown = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp };