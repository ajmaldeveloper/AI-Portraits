-- CreateTable
CREATE TABLE "ShopAIProviderSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeySecret" TEXT NOT NULL,
    "apiKeyLastFour" TEXT NOT NULL,
    "extraConfig" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopAIProviderSettings_shop_key" ON "ShopAIProviderSettings"("shop");
