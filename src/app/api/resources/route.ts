import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSessionUser } from '@/lib/auth';

function unauthorized(error: unknown) { return error instanceof Error && error.message === 'UNAUTHORIZED'; }

export async function GET() {
  try {
    const user = await requireSessionUser();
    const resources = await prisma.resource.findMany({
      where: { userId: user.userId },
      include: { _count: { select: { automations: true } } },
      orderBy: { createdAt: 'desc' },
    });
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
    if ((type === 'URL' || type === 'PDF_LINK' || type === 'FILE') && (typeof url !== 'string' || url.length > 2048 || !/^https:\/\/[^\s]+$/i.test(url))) {
      return NextResponse.json({ error: 'A secure HTTPS URL is required' }, { status: 400 });
    }
    if (type === 'TEXT' && (typeof textContent !== 'string' || !textContent.trim() || textContent.length > 10_000)) {
      return NextResponse.json({ error: 'Text content between 1 and 10,000 characters is required' }, { status: 400 });
    }
    const resource = await prisma.resource.create({
      data: {
        userId: user.userId,
        name: name.trim(),
        type,
        // Type is authoritative: never persist unused fields supplied by clients.
        url: type === 'TEXT' ? null : (typeof url === 'string' ? url.trim() : null),
        textContent: type === 'TEXT' ? (typeof textContent === 'string' ? textContent.trim() : null) : null,
      },
    });
    return NextResponse.json({ resource }, { status: 201 });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    return NextResponse.json({ error: 'Unable to create resource' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Resource ID is required' }, { status: 400 });

    const resource = await prisma.resource.findFirst({
      where: { id, userId: user.userId },
      select: { id: true, _count: { select: { automations: true } } },
    });
    if (!resource) return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    if (resource._count.automations > 0) {
      return NextResponse.json(
        { error: 'This resource is attached to a flow. Remove it from that flow before deleting it.' },
        { status: 409 },
      );
    }

    await prisma.resource.delete({ where: { id: resource.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (unauthorized(error)) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    return NextResponse.json({ error: 'Unable to delete resource' }, { status: 500 });
  }
}
