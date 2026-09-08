
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getMaterialRequestById } from '@/lib/material-request';
import { generateMaterialRequestPdf } from '@/lib/export/pdf';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing material request ID' }, { status: 400 });
    }

    const mr = await getMaterialRequestById(id);
    if (!mr) {
      return NextResponse.json({ error: 'Material request not found' }, { status: 404 });
    }

    const pdfBuffer = await generateMaterialRequestPdf(mr as any);
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${mr.mrNumber}.pdf"`,
      },
    });
  } catch (error) {
    console.error('PDF export error:', error);
    return NextResponse.json({ error: 'Failed to export PDF' }, { status: 500 });
  }
}
