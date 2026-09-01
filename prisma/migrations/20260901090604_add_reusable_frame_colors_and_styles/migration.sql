/*
  Warnings:

  - You are about to drop the column `frameColor` on the `StyleFramingOption` table. All the data in the column will be lost.
  - You are about to drop the column `frameStyle` on the `StyleFramingOption` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "StyleFramingOption" DROP COLUMN "frameColor",
DROP COLUMN "frameStyle",
ADD COLUMN     "frameColorId" TEXT,
ADD COLUMN     "frameStyleId" TEXT;

-- CreateTable
CREATE TABLE "StyleFrameColor" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hexColor" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleFrameColor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleFrameStyle" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cssTreatment" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleFrameStyle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StyleFrameColor_styleId_position_idx" ON "StyleFrameColor"("styleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StyleFrameColor_styleId_label_key" ON "StyleFrameColor"("styleId", "label");

-- CreateIndex
CREATE INDEX "StyleFrameStyle_styleId_position_idx" ON "StyleFrameStyle"("styleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StyleFrameStyle_styleId_label_key" ON "StyleFrameStyle"("styleId", "label");

-- CreateIndex
CREATE INDEX "StyleFramingOption_frameColorId_idx" ON "StyleFramingOption"("frameColorId");

-- CreateIndex
CREATE INDEX "StyleFramingOption_frameStyleId_idx" ON "StyleFramingOption"("frameStyleId");

-- AddForeignKey
ALTER TABLE "StyleFramingOption" ADD CONSTRAINT "StyleFramingOption_frameColorId_fkey" FOREIGN KEY ("frameColorId") REFERENCES "StyleFrameColor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleFramingOption" ADD CONSTRAINT "StyleFramingOption_frameStyleId_fkey" FOREIGN KEY ("frameStyleId") REFERENCES "StyleFrameStyle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleFrameColor" ADD CONSTRAINT "StyleFrameColor_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleFrameStyle" ADD CONSTRAINT "StyleFrameStyle_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;
