-- CreateTable
CREATE TABLE "StyleMatColor" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hexColor" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleMatColor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StyleMatColor_styleId_position_idx" ON "StyleMatColor"("styleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StyleMatColor_styleId_label_key" ON "StyleMatColor"("styleId", "label");

-- AddForeignKey
ALTER TABLE "StyleMatColor" ADD CONSTRAINT "StyleMatColor_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;
