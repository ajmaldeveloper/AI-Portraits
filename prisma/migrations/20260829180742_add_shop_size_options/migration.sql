-- CreateTable
CREATE TABLE "ShopSizeOption" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "scalePercent" INTEGER NOT NULL,
    "priceDelta" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSizeOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopSizeOption_shop_position_idx" ON "ShopSizeOption"("shop", "position");
