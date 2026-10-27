'use strict';

const crypto = require('node:crypto');

function generateLicenseKey() {
  // 32 random bytes = 256 bits of entropy; base64url avoids URL-unsafe characters.
  return 'ak_' + crypto.randomBytes(32).toString('base64url');
}

function hashLicenseKey(key) {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

module.exports = { generateLicenseKey, hashLicenseKey, safeEqual, addDays };