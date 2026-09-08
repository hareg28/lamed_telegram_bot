
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import {
  upsertMaterialRequestRows,
  upsertPurchaseRequestRows,
  appendSupplierRow,
} from '../src/lib/google-sheets';

dotenv.config();

const prisma = new PrismaClient();

async function syncExistingData() {
  console.log('🔄 Syncing existing data to Google Sheets...');

  try {
    // 1. Sync all Material Requests
    console.log('📋 Syncing Material Requests...');
    const materialRequests = await prisma.materialRequest.findMany({
      include: {
        items: true,
        requestedBy: true,
      },
    });

    for (const mr of materialRequests) {
      await upsertMaterialRequestRows(mr as any);
      console.log(`  ✅ Synced MR: ${mr.mrNumber}`);
    }

    // 2. Sync all Purchase Requests
    console.log('📋 Syncing Purchase Requests...');
    const purchaseRequests = await prisma.purchaseRequest.findMany({
      include: {
        items: true,
        purchaser: true,
        materialRequest: {
          include: {
            requestedBy: true,
          },
        },
      },
    });

    for (const pr of purchaseRequests) {
      await upsertPurchaseRequestRows(pr as any);
      console.log(`  ✅ Synced PR: ${pr.prNumber}`);
    }

    // 3. Sync all Suppliers
    console.log('📋 Syncing Suppliers...');
    const suppliers = await prisma.supplier.findMany();
    for (const supplier of suppliers) {
      await appendSupplierRow(supplier);
      console.log(`  ✅ Synced Supplier: ${supplier.name}`);
    }

    console.log('✅ All existing data synced successfully!');
  } catch (error) {
    console.error('❌ Error syncing data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

syncExistingData();