-- CreateTable
CREATE TABLE "ShopGenerationDefaults" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "outputAspectRatio" TEXT NOT NULL DEFAULT '1:1',
    "outputQuality" TEXT NOT NULL DEFAULT 'high',
    "previewCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopGenerationDefaults_shop_key" ON "ShopGenerationDefaults"("shop");
