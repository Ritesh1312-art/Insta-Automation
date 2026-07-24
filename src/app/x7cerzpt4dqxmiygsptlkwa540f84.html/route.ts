import { NextResponse } from 'next/server';

export async function GET() {
  return new NextResponse('x7cerzpt4dqxmiygsptlkwa540f84', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}
