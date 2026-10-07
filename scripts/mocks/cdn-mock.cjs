#!/usr/bin/env node
/**
 * Local stand-in for the Instagram CDN (https://scontent-*.cdninstagram.com).
 *
 *   node scripts/mocks/cdn-mock.cjs [port]     # default 4443
 *
 * The app's profile-picture proxy refuses non-HTTPS and private-network image
 * URLs (src/app/api/meta/profile-picture/route.ts), so the fake CDN has to look
 * like the real one: it serves HTTPS on a hostname that is mapped to 127.0.0.1
 * in /etc/hosts with a locally generated, locally trusted certificate. Nothing
 * in the application is relaxed to make this work — the request it makes is
 * byte-for-byte the request it would make against Meta's CDN.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const PORT = Number(process.argv[2] || process.env.MOCK_CDN_PORT || 4443);
const HOST = process.env.MOCK_CDN_HOST || 'scontent-xx-1.cdninstagram.com';
const DIR = process.env.MOCK_CDN_DIR || '/tmp/cdn-mock';
const LOG = process.env.MOCK_CDN_LOG || '/tmp/cdn-mock-requests.jsonl';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

function ensureHostsEntry() {
  try {
    const hosts = fs.readFileSync('/etc/hosts', 'utf8');
    if (hosts.includes(HOST)) return 'already-present';
    execFileSync('sudo', ['-n', 'sh', '-c', `echo "127.0.0.1 ${HOST}" >> /etc/hosts`]);
    return 'added';
  } catch (error) {
    console.error(`cdn-mock: could not add ${HOST} to /etc/hosts (${error.message}); add it manually`);
    return 'failed';
  }
}

function ensureCertificate() {
  fs.mkdirSync(DIR, { recursive: true });
  const keyPath = path.join(DIR, 'key.pem');
  const certPath = path.join(DIR, 'cert.pem');
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-days', '30',
      '-subj', `/CN=${HOST}`, '-addext', `subjectAltName=DNS:${HOST}`,
    ], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

function log(entry) {
  fs.appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
}

const server = https.createServer(ensureCertificate(), (request, response) => {
  const url = new URL(request.url, `https://${HOST}:${PORT}`);
  log({ method: request.method, path: url.pathname, at: new Date().toISOString() });
  const name = path.basename(url.pathname);

  if (name === 'missing.png') {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    return response.end('not found');
  }
  if (name === 'not-an-image.txt') {
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': 5 });
    return response.end('nope!');
  }
  if (name === 'too-large.png') {
    const big = Buffer.alloc(6 * 1024 * 1024, 0x41);
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': big.length });
    return response.end(big);
  }
  if (name === 'evil-redirect.png') {
    // Off-allowlist: a public host that is not Instagram/Meta.
    response.writeHead(302, { Location: 'https://example.com/not-a-cdn.png' });
    return response.end();
  }
  if (name === 'metadata-redirect.png') {
    // Off-allowlist: the cloud metadata service.
    response.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
    return response.end();
  }
  if (name === 'redirect.png') {
    response.writeHead(302, { Location: `https://${HOST}:${PORT}/cdn/avatar.png` });
    return response.end();
  }
  response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length });
  response.end(PNG);
});

const hostsResult = ensureHostsEntry();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`cdn-mock listening on https://${HOST}:${PORT} (hosts entry: ${hostsResult})`);
  console.log(`NODE_EXTRA_CA_CERTS=${path.join(DIR, 'cert.pem')}`);
});
