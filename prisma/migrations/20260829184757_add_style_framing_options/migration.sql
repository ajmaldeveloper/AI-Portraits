-- CreateTable
CREATE TABLE "StyleFramingOption" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceDelta" DECIMAL(65,30) NOT NULL,
    "compareAtPriceDelta" DECIMAL(65,30),
    "requiresShipping" BOOLEAN NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleFramingOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StyleFramingOption_styleId_position_idx" ON "StyleFramingOption"("styleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StyleFramingOption_styleId_label_key" ON "StyleFramingOption"("styleId", "label");

-- AddForeignKey
ALTER TABLE "StyleFramingOption" ADD CONSTRAINT "StyleFramingOption_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;
