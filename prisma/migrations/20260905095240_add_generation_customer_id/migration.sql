-- AlterTable
ALTER TABLE "Generation" ADD COLUMN     "customerId" TEXT;

-- CreateIndex
CREATE INDEX "Generation_styleId_customerId_status_createdAt_idx" ON "Generation"("styleId", "customerId", "status", "createdAt");

