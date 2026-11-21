#!/usr/bin/env node
// Signs an update installer and writes its update.json (stage 6, B6; ADR-023).
//
//   SINF_UPDATE_KEY=… node tools/sign-update.mjs <installer.exe> <version> [out-dir]
//
// The key is the base64 PKCS#8 private key from tools/update-key.mjs, given only through the
// environment (a CI secret). The signature is ECDSA P-256 / SHA-256 over
// "sinf-update:<version>:<sha256>:<size>", r‖s in base64 — what the updater verifies
// (apps/desktop-core/Updates.cs) and the platform too (apps/server/src/services/updates.ts).
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [installer, version, outDir = 'out/update'] = process.argv.slice(2);
const key = process.env.SINF_UPDATE_KEY?.trim();
if (!installer || !version) {
  console.error('usage: node tools/sign-update.mjs <installer.exe> <version> [out-dir]');
  process.exit(2);
}
if (!key) {
  console.error('SINF_UPDATE_KEY is not set: the update is not signed');
  process.exit(3);
}
if (!/^\d{1,4}\.\d{1,4}\.\d{1,6}(?:\.\d{1,6})?$/.test(version)) {
  console.error(`not a version: ${version}`);
  process.exit(2);
}

const bytes = readFileSync(installer);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const size = statSync(installer).size;
const message = `sinf-update:${version}:${sha256}:${size}`;
const privateKey = createPrivateKey({
  key: Buffer.from(key, 'base64'),
  format: 'der',
  type: 'pkcs8',
});
const signature = sign('sha256', Buffer.from(message), {
  key: privateKey,
  dsaEncoding: 'ieee-p1363',
}).toString('base64');

const file = basename(installer);
mkdirSync(outDir, { recursive: true });
copyFileSync(installer, join(outDir, file));
const manifest = { version, file, sha256, size, signature };
writeFileSync(join(outDir, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `signed ${file}: ${version}, ${(size / 1024 / 1024).toFixed(1)} MB, sha256 ${sha256.slice(0, 12)}…`,
);
