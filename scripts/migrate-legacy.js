'use strict';

// One-time import from the old key.json format. The original key values are
// hashed before insertion; device IPs are intentionally not imported as device IDs.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const Database = require('../db');
const { hashLicenseKey } = require('../apikey');

const legacyPath = path.join(process.cwd(), 'key.json');
if (!fs.existsSync(legacyPath)) {
  console.error('key.json not found. Nothing to migrate.');
  process.exit(1);
}
const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
const db = new Database();
let imported = 0;
try {
  for (const [key, value] of Object.entries(legacy)) {
    const days = Number(value.days);
    const deviceLimit = Number(value.limitDevice);
    if (!key || !Number.isInteger(days) || days < 1 || days > 3650 ||
        !Number.isInteger(deviceLimit) || deviceLimit < 1 || deviceLimit > 100) {
      console.warn(`Skipping invalid legacy record: ${String(key).slice(0, 8)}`);
      continue;
    }
    const expiresAt = value.expiryDate ? new Date(value.expiryDate) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      console.warn(`Skipping invalid expiry for key prefix ${key.slice(0, 8)}`);
      continue;
    }
    const added = db.importLegacyLicense({
      keyHash: hashLicenseKey(key),
      keyPrefix: key.slice(0, 8),
      type: typeof value.type === 'string' ? value.type : 'free',
      days,
      deviceLimit,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      createdAt: new Date().toISOString(),
    });
    if (added) imported++;
  }
  console.log(`Imported ${imported} license(s). Existing keys were not overwritten.`);
  console.log('Legacy device IPs were not imported. Keep a secure backup, then remove key.json from the deployed app.');
} finally {
  db.close();
}