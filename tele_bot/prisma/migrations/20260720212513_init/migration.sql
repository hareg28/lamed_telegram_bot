-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('REQUESTER', 'PROJECT_MANAGER', 'PURCHASER', 'ADMINISTRATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED_FOR_PURCHASING', 'WAITING_FINAL_APPROVAL', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ORDERED', 'DELIVERED', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING_DELIVERY', 'PARTIALLY_DELIVERED', 'DELIVERED', 'DELAYED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('MR_SUBMITTED', 'MR_APPROVED', 'MR_REJECTED', 'PURCHASE_SUBMITTED', 'PURCHASE_APPROVED', 'PURCHASE_REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "telegramUsername" TEXT,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'REQUESTER',
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "boqList" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequest" (
    "id" TEXT NOT NULL,
    "mrNumber" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "projectType" TEXT,
    "boq" TEXT,
    "prNumber" TEXT,
    "requestedById" TEXT NOT NULL,
    "requesterName" TEXT,
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "lineId" TEXT,
    "itemName" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyName" TEXT,
    "contactPerson" TEXT,
    "phone" TEXT,
    "altPhone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "tinNumber" TEXT,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatReceiptNumber" TEXT,
    "bankName" TEXT,
    "accountName" TEXT,
    "accountNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "prNumber" TEXT NOT NULL,
    "materialRequestId" TEXT NOT NULL,
    "purchaserId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierCompanyName" TEXT,
    "supplierPhone" TEXT,
    "supplierBankName" TEXT,
    "vatReceiptNumber" TEXT,
    "accountNumber" TEXT,
    "subtotal" DECIMAL(65,30) NOT NULL,
    "vatAmount" DECIMAL(65,30) NOT NULL,
    "grandTotal" DECIMAL(65,30) NOT NULL,
    "vatStatus" TEXT NOT NULL DEFAULT 'VAT 15%',
    "expectedDeliveryDate" TIMESTAMP(3),
    "actualDeliveryDate" TIMESTAMP(3),
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDING_DELIVERY',
    "deliveryRemarks" TEXT,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvedById" TEXT,
    "approvalDate" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "purchasedDate" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequestItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "materialRequestItemId" TEXT,
    "lineId" TEXT,
    "itemName" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "priceType" TEXT NOT NULL DEFAULT 'Excluding VAT',
    "discountPct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "vatPct" DECIMAL(65,30) NOT NULL DEFAULT 15,
    "vatAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "amount" DECIMAL(65,30) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalHistory" (
    "id" TEXT NOT NULL,
    "materialRequestId" TEXT,
    "purchaseRequestId" TEXT,
    "action" "ApprovalAction" NOT NULL,
    "performedById" TEXT NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormDraft" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "userId" TEXT,
    "step" TEXT NOT NULL DEFAULT 'idle',
    "flowType" TEXT NOT NULL DEFAULT 'mr',
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "materialRequestId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequest_mrNumber_key" ON "MaterialRequest"("mrNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_supplierId_key" ON "Supplier"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_prNumber_key" ON "PurchaseRequest"("prNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FormDraft_telegramId_key" ON "FormDraft"("telegramId");

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestItem" ADD CONSTRAINT "MaterialRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_purchaserId_fkey" FOREIGN KEY ("purchaserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "PurchaseRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_materialRequestItemId_fkey" FOREIGN KEY ("materialRequestItemId") REFERENCES "MaterialRequestItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_materialRequestId_fkey" FOREIGN KEY ("materialRequestId") REFERENCES "MaterialRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormDraft" ADD CONSTRAINT "FormDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
