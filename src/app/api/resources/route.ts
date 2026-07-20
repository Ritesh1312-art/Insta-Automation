import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const resources = await prisma.resource.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ resources });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, type, url, textContent } = await req.json();

    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({
        data: { email: 'admin@example.com', passwordHash: 'hash', name: 'Creator' },
      });
    }

    const resource = await prisma.resource.create({
      data: {
        userId: user.id,
        name,
        type: type || 'URL',
        url,
        textContent,
      },
    });

    return NextResponse.json({ resource }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
