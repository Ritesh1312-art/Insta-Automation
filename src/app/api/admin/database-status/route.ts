import { NextResponse } from 'next/server';
import { inferDatabaseStatus } from '@/lib/database-status';
import { isAuthError, requireAdmin } from '@/lib/require-admin';

export const dynamic = 'force-dynamic';

function noStoreJson(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    if (isAuthError(error, 'UNAUTHORIZED')) {
      return noStoreJson({ error: 'Authentication required' }, 401);
    }
    if (isAuthError(error, 'FORBIDDEN')) {
      return noStoreJson({ error: 'Admin only' }, 403);
    }

    // Do not log the error: authentication/database exceptions can contain
    // connection details. This endpoint intentionally returns no diagnostics.
    return noStoreJson({ error: 'Unable to load database status' }, 500);
  }

  // This API route runs only on the server. Read the connection string after
  // authorization and pass it to an inference helper that returns no URL data.
  const status = inferDatabaseStatus(process.env.DATABASE_URL);
  return noStoreJson(status);
}
