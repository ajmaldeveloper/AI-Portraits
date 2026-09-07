-- AlterEnum
ALTER TYPE "StyleAssetKind" ADD VALUE 'CUSTOMER_PARTIAL';

-- AlterTable
ALTER TABLE "Generation" ADD COLUMN     "partialAssetId" TEXT,
ADD COLUMN     "partialIndex" INTEGER;

