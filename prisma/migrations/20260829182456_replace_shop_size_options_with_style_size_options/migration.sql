/*
  Warnings:

  - You are about to drop the `ShopSizeOption` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "ShopSizeOption";

-- CreateTable
CREATE TABLE "StyleSizeOption" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "scalePercent" INTEGER NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "compareAtPrice" DECIMAL(65,30),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleSizeOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StyleSizeOption_styleId_position_idx" ON "StyleSizeOption"("styleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StyleSizeOption_styleId_label_key" ON "StyleSizeOption"("styleId", "label");

-- AddForeignKey
ALTER TABLE "StyleSizeOption" ADD CONSTRAINT "StyleSizeOption_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;
