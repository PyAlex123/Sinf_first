#!/usr/bin/env node
// Makes the key pair that signs updates of the Windows app (stage 6, B6; ADR-023).
//
//   node tools/update-key.mjs
//
// Run it once, on your own computer. It prints two values:
//   - SINF_UPDATE_KEY (private) → GitHub: Settings → Secrets and variables → Actions → Secrets.
//     Nowhere else: not in git, not in chat, not on the server.
//   - SINF_UPDATE_PUBLIC_KEY (public) → the same page, tab "Variables"; CI builds it into the
//     updater. Optionally also UPDATE_PUBLIC_KEY in the platform's .env.
// A new pair means computers with the old updater no longer accept updates: keep the private key safe.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const secret = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const visible = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

console.log('SINF_UPDATE_KEY (секрет — только в GitHub Secrets):');
console.log(secret);
console.log('');
console.log('SINF_UPDATE_PUBLIC_KEY (открытый — GitHub Variables и UPDATE_PUBLIC_KEY сайта):');
console.log(visible);
