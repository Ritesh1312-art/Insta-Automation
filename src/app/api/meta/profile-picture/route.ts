import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/encryption';
import { requireSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_PROFILE_PICTURE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
  Vary: 'Cookie',
} as const;

function isUnauthorized(error: unknown): boolean {
  return error instanceof Error && error.message === 'UNAUTHORIZED';
}

function logSafeFailure(reason: string) {
  console.error('[meta:profile-picture] request failed', { reason });
}

function parseSafeCdnUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === '0.0.0.0' ||
      host === '[::1]' ||
      host.startsWith('[') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function readBoundedImageBytes(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const declaredLength = Number(contentLengthHeader);
    if (!Number.isFinite(declaredLength) || declaredLength <= 0 || declaredLength > maxBytes) {
      return { ok: false, reason: 'invalid_content_length' };
    }
  }

  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) {
      return { ok: false, reason: 'invalid_image_size' };
    }
    return { ok: true, bytes: buffer };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return { ok: false, reason: 'image_too_large' };
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    return { ok: false, reason: 'empty_image' };
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function GET(_req?: NextRequest) {
  try {
    const user = await requireSessionUser();

    const connection = await prisma.metaConnection.findFirst({
      where: { userId: user.userId, connectionStatus: 'CONNECTED' },
      orderBy: { createdAt: 'desc' },
    });

    if (
      !connection ||
      (connection.connectionStatus && connection.connectionStatus !== 'CONNECTED') ||
      !connection.instagramAccountId ||
      !connection.accessTokenEncrypted
    ) {
      return NextResponse.json(
        { error: 'Profile picture not found' },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    let accessToken = '';
    try {
      accessToken = decryptToken(connection.accessTokenEncrypted);
    } catch {
      logSafeFailure('token_decryption_failed');
      return NextResponse.json(
        { error: 'Unable to load Instagram profile picture' },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Profile picture not found' },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const graphApiVersion = process.env.META_GRAPH_API_VERSION || 'v26.0';
    if (!/^v\d+\.\d+$/.test(graphApiVersion)) {
      logSafeFailure('invalid_graph_version');
      return NextResponse.json(
        { error: 'Unable to load Instagram profile picture' },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    let graphResponse: Response;
    try {
      graphResponse = await fetch(
        `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(connection.instagramAccountId)}?fields=profile_picture_url`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        },
      );
    } catch {
      logSafeFailure('graph_request_failed');
      return NextResponse.json(
        { error: 'Unable to load Instagram profile picture' },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    if (graphResponse.status === 404) {
      return NextResponse.json(
        { error: 'Profile picture not found' },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    if (!graphResponse.ok) {
      logSafeFailure('graph_bad_status');
      return NextResponse.json(
        { error: 'Unable to load Instagram profile picture' },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    const graphData = await graphResponse.json().catch(() => null);
    if (!graphData || typeof graphData !== 'object') {
      logSafeFailure('graph_invalid_json');
      return NextResponse.json(
        { error: 'Unable to load Instagram profile picture' },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    const rawPictureUrl =
      typeof (graphData as { profile_picture_url?: unknown }).profile_picture_url === 'string'
        ? (graphData as { profile_picture_url: string }).profile_picture_url.trim()
        : '';

    if (!rawPictureUrl) {
      return NextResponse.json(
        { error: 'Profile picture not found' },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const safePictureUrl = parseSafeCdnUrl(rawPictureUrl);
    if (!safePictureUrl) {
      logSafeFailure('unsafe_picture_url');
      return NextResponse.json(
        { error: 'Unable to load Instagram profile picture' },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    if (
      rawPictureUrl !== connection.profilePictureUrl &&
      typeof prisma.metaConnection.update === 'function'
    ) {
      await prisma.metaConnection
        .update({
          where: connection.id
            ? { id: connection.id }
            : { instagramAccountId: connection.instagramAccountId },
          data: { profilePictureUrl: rawPictureUrl },
        })
        .catch(() => undefined);
    }

    let imageResponse: Response;
    try {
      imageResponse = await fetch(safePictureUrl.toString(), {
        headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' },
        cache: 'no-store',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      logSafeFailure('cdn_request_failed');
      return NextResponse.json(
        { error: 'Unable to load Instagram profile picture' },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    if (imageResponse.url && !parseSafeCdnUrl(imageResponse.url)) {
      logSafeFailure('unsafe_redirect_url');
      return NextResponse.json(
        { error: 'Unable to load Instagram profile picture' },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    if (imageResponse.status === 404) {
      return NextResponse.json(
        { error: 'Profile picture not found' },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    if (!imageResponse.ok) {
      logSafeFailure('cdn_bad_status');
      return NextResponse.json(
        { error: 'Unable to load Instagram profile picture' },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    const rawContentType = imageResponse.headers.get('content-type') || '';
    const contentType = rawContentType.split(';')[0]?.trim().toLowerCase() || '';
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      logSafeFailure('invalid_content_type');
      return NextResponse.json(
        { error: 'Unable to load Instagram profile picture' },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    const readResult = await readBoundedImageBytes(imageResponse, MAX_PROFILE_PICTURE_BYTES);
    if (!readResult.ok) {
      logSafeFailure(readResult.reason);
      return NextResponse.json(
        { error: 'Unable to load Instagram profile picture' },
        { status: 502, headers: NO_STORE_HEADERS },
      );
    }

    return new NextResponse(new Uint8Array(readResult.bytes), {
      status: 200,
      headers: {
        'Content-Type': contentType === 'image/jpg' ? 'image/jpeg' : contentType,
        'Content-Length': String(readResult.bytes.byteLength),
        'Cache-Control': 'private, max-age=300, stale-while-revalidate=60',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (isUnauthorized(error)) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    logSafeFailure('internal_error');
    return NextResponse.json(
      { error: 'Unable to load Instagram profile picture' },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
