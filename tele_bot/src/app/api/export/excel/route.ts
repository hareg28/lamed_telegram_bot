
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getMaterialRequestById } from '@/lib/material-request';
import { generateMaterialRequestExcel } from '@/lib/export/excel';

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

    const excelBuffer = await generateMaterialRequestExcel(mr as any);
    return new NextResponse(new Uint8Array(excelBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${mr.mrNumber}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Excel export error:', error);
    return NextResponse.json({ error: 'Failed to export Excel' }, { status: 500 });
  }
}
