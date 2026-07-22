import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';

function unauthorized(error: unknown) { return error instanceof Error && error.message === 'UNAUTHORIZED'; }

export async function GET() {
  try {
    const user = await requireSessionUser();
    const resources = await prisma.resource.findMany({ where: { userId: user.userId }, orderBy: { createdAt: 'desc' } });
    return NextResponse.json({ resources });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    return NextResponse.json({ error: 'Unable to load resources' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const { name, type = 'URL', url, textContent } = await req.json();
    if (typeof name !== 'string' || !name.trim() || name.length > 160 || !['URL', 'TEXT', 'PDF_LINK', 'FILE'].includes(type)) {
      return NextResponse.json({ error: 'Invalid resource' }, { status: 400 });
    }
    if ((type === 'URL' || type === 'PDF_LINK' || type === 'FILE') && (typeof url !== 'string' || !/^https:\/\//i.test(url))) {
      return NextResponse.json({ error: 'A secure HTTPS URL is required' }, { status: 400 });
    }
    if (type === 'TEXT' && (typeof textContent !== 'string' || !textContent.trim())) {
      return NextResponse.json({ error: 'Text content is required' }, { status: 400 });
    }
    const resource = await prisma.resource.create({ data: { userId: user.userId, name: name.trim(), type, url: url || null, textContent: textContent || null } });
    return NextResponse.json({ resource }, { status: 201 });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    return NextResponse.json({ error: 'Unable to create resource' }, { status: 500 });
  }
}
