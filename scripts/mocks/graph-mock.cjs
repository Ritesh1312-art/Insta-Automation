#!/usr/bin/env node
/**
 * Local stand-in for the Meta Graph API (https://graph.facebook.com).
 *
 *   node scripts/mocks/graph-mock.cjs [port]        # default 4010
 *   MOCK_CDN_URL=https://host:port scripts/mocks/graph-mock.cjs
 *
 * Endpoints (all under /v26.0/...):
 *   GET  /oauth/access_token          - code -> short-lived token
 *   GET  /oauth/access_token (grant_type=fb_exchange_token) - long-lived token
 *   GET  /me?fields=id
 *   GET  /me/accounts                 - one Facebook Page with an IG business account
 *   POST /<id>/subscribed_apps        - webhook subscription
 *   GET  /<ig_id>/media               - paginated media list
 *   GET  /<ig_id>?fields=profile_picture_url
 *   GET  /<ig_id>?fields=username,name,is_user_follow_business
 *   GET  /<comment_id>?fields=...     - comment details
 *   POST /<ig_id>/messages            - private reply / direct message
 *   POST /<comment_id>/replies        - public reply
 *
 * Every request is appended to /tmp/graph-mock-requests.jsonl so tests can
 * assert on what the application actually sent (headers, body, tokens).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.argv[2] || process.env.MOCK_GRAPH_PORT || 4010);
const LOG_PATH = process.env.MOCK_GRAPH_LOG || '/tmp/graph-mock-requests.jsonl';
const CDN_BASE = process.env.MOCK_CDN_URL || `http://127.0.0.1:${PORT}`;

const TOKEN = 'EAAG-mock-page-access-token-0123456789';
const IG_ACCOUNT_ID = 'ig-mock-1';
const PAGE_ID = 'page-mock-1';

/** Flipped by the tests to exercise the not-following branch. */
const state = {
  isUserFollowingBusiness: process.env.MOCK_FOLLOWING !== 'false',
  /** Path (and query) of the CDN object Meta reports as the profile picture. */
  avatarPath: '/cdn/avatar.png',
  mediaError: null,
  messagingError: null,
  publicReplyError: null,
};

function log(entry) {
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
}

function json(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function mediaPage(pageNumber) {
  return {
    data: [
      {
        id: `media-${pageNumber}-1`,
        media_type: 'VIDEO',
        media_product_type: 'REELS',
        caption: `Mock reel ${pageNumber}`,
        permalink: `https://www.instagram.com/reel/media-${pageNumber}-1/`,
        media_url: `${CDN_BASE}/cdn/reel-${pageNumber}.mp4`,
        thumbnail_url: `${CDN_BASE}/cdn/reel-${pageNumber}.jpg`,
        timestamp: new Date(Date.UTC(2026, 0, pageNumber + 1)).toISOString(),
      },
      {
        id: `media-${pageNumber}-2`,
        media_type: 'CAROUSEL_ALBUM',
        caption: `Mock carousel ${pageNumber}`,
        permalink: `https://www.instagram.com/p/media-${pageNumber}-2/`,
        timestamp: new Date(Date.UTC(2026, 0, pageNumber + 2)).toISOString(),
        children: {
          data: [{ id: `child-${pageNumber}`, media_type: 'IMAGE', media_url: `${CDN_BASE}/cdn/child-${pageNumber}.jpg` }],
        },
      },
    ],
    paging: pageNumber < 2
      ? { next: `http://127.0.0.1:${PORT}/v26.0/${IG_ACCOUNT_ID}/media?fields=id&limit=50&after=CURSOR${pageNumber}` }
      : undefined,
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  const body = request.method === 'POST' ? await readBody(request) : '';
  const pathname = url.pathname;
  const segments = pathname.split('/').filter(Boolean); // [v26.0, ...]

  log({
    method: request.method,
    path: pathname,
    query: Object.fromEntries(url.searchParams),
    authorization: request.headers.authorization || null,
    body: body || null,
  });

  // --- CDN / image endpoints used by the profile-picture proxy --------------
  if (pathname.startsWith('/cdn/')) {
    const name = path.basename(pathname);
    if (name === 'too-large.png') {
      const big = Buffer.alloc(6 * 1024 * 1024, 0x41);
      response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': big.length });
      response.end(big);
      return;
    }
    if (name === 'not-an-image.txt') {
      const text = 'this is not an image';
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': text.length });
      response.end(text);
      return;
    }
    if (name === 'missing.png') {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('not found');
      return;
    }
    if (name === 'redirect.png') {
      response.writeHead(302, { Location: `${CDN_BASE}/cdn/avatar.png` });
      response.end();
      return;
    }
    if (name === 'evil-redirect.png') {
      response.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      response.end();
      return;
    }
    // 1x1 transparent PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
    response.end(png);
    return;
  }

  if (segments.length < 2) {
    return json(response, 400, { error: { message: 'bad request', code: 100 } });
  }

  const [, target, action] = segments;

  // --- OAuth ---------------------------------------------------------------
  if (target === 'oauth' && action === 'access_token') {
    if (url.searchParams.get('grant_type') === 'fb_exchange_token') {
      return json(response, 200, { access_token: TOKEN, token_type: 'bearer', expires_in: 5183999 });
    }
    if (!url.searchParams.get('code')) {
      return json(response, 400, { error: { message: 'Missing authorization code', code: 100, type: 'OAuthException' } });
    }
    if (url.searchParams.get('code') === 'BAD_CODE') {
      return json(response, 400, { error: { message: 'Invalid verification code format.', code: 100, type: 'OAuthException' } });
    }
    return json(response, 200, { access_token: 'short-lived-token', token_type: 'bearer', expires_in: 3600 });
  }

  if (target === 'me' && action === undefined) {
    if (!request.headers.authorization) return json(response, 401, { error: { message: 'no token', code: 190 } });
    return json(response, 200, { id: 'meta-user-1' });
  }

  if (target === 'me' && action === 'accounts') {
    return json(response, 200, {
      data: [{
        id: PAGE_ID,
        access_token: TOKEN,
        instagram_business_account: {
          id: IG_ACCOUNT_ID,
          username: 'mock.creator',
          profile_picture_url: `${CDN_BASE}${state.avatarPath}`,
        },
      }],
    });
  }

  if (action === 'subscribed_apps') {
    // Any token containing "expired" reproduces Meta's code 190 rejection so
    // the re-authorization path can be exercised for real.
    const authorization = request.headers.authorization || '';
    if (authorization.includes('expired')) {
      return json(response, 400, {
        error: {
          message: 'Error validating access token: Session has expired on Tuesday, 30-Jun-26 08:00:00 PDT.',
          type: 'OAuthException',
          code: 190,
          error_subcode: 463,
        },
      });
    }
    return json(response, 200, { success: true });
  }

  if (action === 'media') {
    if (state.mediaError) return json(response, 400, state.mediaError);
    const after = url.searchParams.get('after');
    const page = after ? Number(after.replace('CURSOR', '')) + 1 : 1;
    return json(response, 200, mediaPage(page));
  }

  if (action === 'messages') {
    if (state.messagingError) return json(response, 400, state.messagingError);
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch { /* ignore */ }
    return json(response, 200, { recipient_id: parsed?.recipient?.id || parsed?.recipient?.comment_id, message_id: 'mid-mock-1' });
  }

  if (action === 'replies') {
    if (state.publicReplyError) return json(response, 400, state.publicReplyError);
    return json(response, 200, { id: 'reply-mock-1' });
  }

  // --- Node lookups --------------------------------------------------------
  if (action === undefined) {
    const fields = (url.searchParams.get('fields') || '').split(',').map((field) => field.trim());
    if (fields.includes('profile_picture_url')) {
      if (target === 'no-picture-account') return json(response, 200, { id: target });
      return json(response, 200, { profile_picture_url: `${CDN_BASE}${state.avatarPath}`, id: target });
    }
    if (fields.includes('is_user_follow_business')) {
      return json(response, 200, {
        id: target,
        username: 'fan.account',
        name: 'Fan Account',
        is_user_follow_business: state.isUserFollowingBusiness,
      });
    }
    if (fields.includes('media')) {
      return json(response, 200, {
        id: target,
        text: 'guide please',
        from: { id: 'commenter-1', username: 'fan.account' },
        media: { id: 'resolved-media-1' },
      });
    }
    return json(response, 200, { id: target });
  }

  // --- Control plane (not part of the real Graph API) ----------------------
  if (target === '__control') {
    if (action === 'following') {
      state.isUserFollowingBusiness = url.searchParams.get('value') !== 'false';
      return json(response, 200, { isUserFollowingBusiness: state.isUserFollowingBusiness });
    }
    if (action === 'media-error') {
      state.mediaError = url.searchParams.get('code')
        ? { error: { message: 'Error validating access token', code: Number(url.searchParams.get('code')), type: 'OAuthException' } }
        : null;
      return json(response, 200, { mediaError: state.mediaError });
    }
    if (action === 'messaging-error') {
      state.messagingError = url.searchParams.get('code')
        ? { error: { message: 'Service temporarily unavailable', code: Number(url.searchParams.get('code')) } }
        : null;
      return json(response, 200, { messagingError: state.messagingError });
    }
    if (action === 'avatar') {
      state.avatarPath = url.searchParams.get('path') || '/cdn/avatar.png';
      return json(response, 200, { avatarPath: state.avatarPath });
    }
    if (action === 'reset') {
      state.isUserFollowingBusiness = true;
      state.avatarPath = '/cdn/avatar.png';
      state.mediaError = null;
      state.messagingError = null;
      state.publicReplyError = null;
      return json(response, 200, { reset: true });
    }
  }

  return json(response, 404, { error: { message: `Unsupported Graph path ${pathname}`, code: 100 } });
});

if (process.env.MOCK_GRAPH_LOG !== 'off') {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
}
server.listen(PORT, '127.0.0.1', () => {
  console.log(`graph-mock listening on http://127.0.0.1:${PORT} (log ${LOG_PATH})`);
});
