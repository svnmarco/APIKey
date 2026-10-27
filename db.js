'use strict';

const path = require('node:path');
const DatabaseSync = require('better-sqlite3');

class LicenseDatabase {
  constructor(filename = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'licenses.sqlite')) {
    if (filename !== ':memory:') {
      require('node:fs').mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    }
    this.sqlite = new DatabaseSync(filename);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('busy_timeout = 5000');
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS licenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        type TEXT NOT NULL,
        days INTEGER NOT NULL CHECK(days BETWEEN 1 AND 3650),
        device_limit INTEGER NOT NULL CHECK(device_limit BETWEEN 1 AND 100),
        expires_at TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE(license_id, device_id)
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        license_id INTEGER,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_devices_license ON devices(license_id);
      CREATE INDEX IF NOT EXISTS idx_audit_license ON audit_logs(license_id, created_at);
    `);
  }

  createLicense({ keyHash, keyPrefix, type, days, deviceLimit, createdAt }) {
    const result = this.sqlite.prepare(`
      INSERT INTO licenses (key_hash, key_prefix, type, days, device_limit, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(keyHash, keyPrefix, type, days, deviceLimit, createdAt);
    return this.findLicenseById(Number(result.lastInsertRowid));
  }

  findLicenseByHash(hash) {
    return this.sqlite.prepare('SELECT * FROM licenses WHERE key_hash = ?').get(hash) || null;
  }

  findLicenseById(id) {
    return this.sqlite.prepare('SELECT * FROM licenses WHERE id = ?').get(id) || null;
  }

  listLicenses() {
    return this.sqlite.prepare(`
      SELECT l.id, l.key_prefix AS keyPrefix, l.type, l.days,
        l.device_limit AS deviceLimit, l.expires_at AS expiresAt,
        l.status, l.created_at AS createdAt, l.revoked_at AS revokedAt,
        (SELECT COUNT(*) FROM devices d WHERE d.license_id = l.id) AS registeredDevices
      FROM licenses l ORDER BY l.id DESC LIMIT 500
    `).all();
  }

  hasDevice(licenseId, deviceId) {
    return Boolean(this.sqlite.prepare(
      'SELECT 1 FROM devices WHERE license_id = ? AND device_id = ?'
    ).get(licenseId, deviceId));
  }

  countDevices(licenseId) {
    return this.sqlite.prepare('SELECT COUNT(*) AS count FROM devices WHERE license_id = ?')
      .get(licenseId).count;
  }

  registerDeviceAndActivate(licenseId, deviceId, expiresAt, now, deviceLimit) {
    // Keep capacity check and registration in one SQLite transaction so two
    // concurrent requests cannot both claim the final device slot.
    const transaction = this.sqlite.transaction(() => {
      const exists = this.sqlite.prepare(
        'SELECT 1 FROM devices WHERE license_id = ? AND device_id = ?'
      ).get(licenseId, deviceId);
      if (!exists) {
        const count = this.sqlite.prepare(
          'SELECT COUNT(*) AS count FROM devices WHERE license_id = ?'
        ).get(licenseId).count;
        if (count >= deviceLimit) return false;
      }
      this.sqlite.prepare(`
        UPDATE licenses SET expires_at = COALESCE(expires_at, ?) WHERE id = ?
      `).run(expiresAt, licenseId);
      this.sqlite.prepare(`
        INSERT INTO devices (license_id, device_id, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(license_id, device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
      `).run(licenseId, deviceId, now, now);
      return true;
    });
    return transaction();
  }

  revokeLicense(id, revokedAt) {
    return this.sqlite.prepare(
      "UPDATE licenses SET status = 'revoked', revoked_at = ? WHERE id = ? AND status != 'revoked'"
    ).run(revokedAt, id).changes > 0;
  }

  resetDevices(id) {
    return this.sqlite.prepare('DELETE FROM devices WHERE license_id = ?').run(id).changes;
  }

  audit(event, licenseId, details = {}) {
    // Never place the plaintext license key or admin token in audit details.
    this.sqlite.prepare(`
      INSERT INTO audit_logs (event, license_id, details_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(event, licenseId, JSON.stringify(details), new Date().toISOString());
  }

  importLegacyLicense({ keyHash, keyPrefix, type, days, deviceLimit, expiresAt, createdAt }) {
    return this.sqlite.prepare(`
      INSERT OR IGNORE INTO licenses
        (key_hash, key_prefix, type, days, device_limit, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(keyHash, keyPrefix, type, days, deviceLimit, expiresAt, createdAt).changes > 0;
  }

  close() {
    this.sqlite.close();
  }
}

module.exports = LicenseDatabase;