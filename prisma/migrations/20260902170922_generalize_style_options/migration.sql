-- CreateEnum
CREATE TYPE "StyleOptionType" AS ENUM ('TEXT', 'COLOR_SWATCH', 'IMAGE_SWATCH');

-- CreateEnum
CREATE TYPE "StyleOptionRole" AS ENUM ('VARIANT', 'EXTRA');

-- CreateEnum
CREATE TYPE "StyleOptionAxisRole" AS ENUM ('SIZE', 'FRAMING');

-- AlterEnum
ALTER TYPE "StyleAssetKind" ADD VALUE 'FRAME_TEXTURE';

-- DropForeignKey
ALTER TABLE "StyleFramingOption" DROP CONSTRAINT "StyleFramingOption_styleId_fkey";

-- DropForeignKey
ALTER TABLE "StyleMatColor" DROP CONSTRAINT "StyleMatColor_styleId_fkey";

-- DropForeignKey
ALTER TABLE "StyleSizeOption" DROP CONSTRAINT "StyleSizeOption_styleId_fkey";

-- DropTable
DROP TABLE "StyleFramingOption";

-- DropTable
DROP TABLE "StyleMatColor";

-- DropTable
DROP TABLE "StyleSizeOption";

-- CreateTable
CREATE TABLE "StyleOption" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "StyleOptionType" NOT NULL,
    "role" "StyleOptionRole" NOT NULL,
    "axisRole" "StyleOptionAxisRole",
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleOptionChoice" (
    "id" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceDelta" DECIMAL(65,30),
    "compareAtPriceDelta" DECIMAL(65,30),
    "requiresShipping" BOOLEAN NOT NULL DEFAULT false,
    "scalePercent" INTEGER,
    "hexColor" TEXT,
    "frameImageAssetId" TEXT,
    "borderThicknessPx" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleOptionChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StyleOption_styleId_position_idx" ON "StyleOption"("styleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StyleOption_styleId_label_key" ON "StyleOption"("styleId", "label");

-- CreateIndex
CREATE INDEX "StyleOptionChoice_optionId_position_idx" ON "StyleOptionChoice"("optionId", "position");

-- CreateIndex
CREATE INDEX "StyleOptionChoice_frameImageAssetId_idx" ON "StyleOptionChoice"("frameImageAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "StyleOptionChoice_optionId_label_key" ON "StyleOptionChoice"("optionId", "label");

-- AddForeignKey
ALTER TABLE "StyleOption" ADD CONSTRAINT "StyleOption_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleOptionChoice" ADD CONSTRAINT "StyleOptionChoice_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "StyleOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleOptionChoice" ADD CONSTRAINT "StyleOptionChoice_frameImageAssetId_fkey" FOREIGN KEY ("frameImageAssetId") REFERENCES "StyleAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

