-- AlterEnum
BEGIN;
CREATE TYPE "StyleOptionType_new" AS ENUM ('TEXT', 'COLOR_SWATCH');
ALTER TABLE "StyleOption" ALTER COLUMN "type" TYPE "StyleOptionType_new" USING ("type"::text::"StyleOptionType_new");
ALTER TYPE "StyleOptionType" RENAME TO "StyleOptionType_old";
ALTER TYPE "StyleOptionType_new" RENAME TO "StyleOptionType";
DROP TYPE "public"."StyleOptionType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "StyleOptionChoice" DROP CONSTRAINT "StyleOptionChoice_frameImageAssetId_fkey";

-- DropIndex
DROP INDEX "StyleOptionChoice_frameImageAssetId_idx";

-- AlterTable
ALTER TABLE "StyleOptionChoice" DROP COLUMN "frameImageAssetId",
ADD COLUMN     "imageAssetId" TEXT;

-- CreateIndex
CREATE INDEX "StyleOptionChoice_imageAssetId_idx" ON "StyleOptionChoice"("imageAssetId");

-- AddForeignKey
ALTER TABLE "StyleOptionChoice" ADD CONSTRAINT "StyleOptionChoice_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "StyleAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

