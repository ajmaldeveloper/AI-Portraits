-- CreateTable
CREATE TABLE "Style" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "prompt" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT,
    "outputAspectRatio" TEXT NOT NULL DEFAULT '1:1',
    "outputQuality" TEXT NOT NULL DEFAULT 'high',
    "previewCount" INTEGER NOT NULL DEFAULT 1,
    "generationSettings" JSONB NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL DEFAULT '',
    "basePrice" DECIMAL NOT NULL DEFAULT 0,
    "tags" JSONB NOT NULL,
    "collectionIds" JSONB NOT NULL,
    "productSettings" JSONB NOT NULL,
    "shopifyProductId" TEXT,
    "shopifyProductHandle" TEXT,
    "publishedAt" DATETIME,
    "publishError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StyleField" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "styleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "placeholder" TEXT,
    "helpText" TEXT,
    "defaultValue" TEXT,
    "options" JSONB,
    "config" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StyleField_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StyleAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "styleId" TEXT NOT NULL,
    "generationId" TEXT,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT,
    "url" TEXT,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "altText" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StyleAsset_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StyleAsset_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "prompt" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "inputPayload" JSONB,
    "outputPayload" JSONB,
    "usage" JSONB,
    "costMicros" BIGINT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Generation_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Style_shopifyProductId_key" ON "Style"("shopifyProductId");

-- CreateIndex
CREATE INDEX "Style_shop_status_idx" ON "Style"("shop", "status");

-- CreateIndex
CREATE INDEX "Style_shop_createdAt_idx" ON "Style"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "StyleField_styleId_position_idx" ON "StyleField"("styleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StyleField_styleId_key_key" ON "StyleField"("styleId", "key");

-- CreateIndex
CREATE INDEX "StyleAsset_styleId_kind_idx" ON "StyleAsset"("styleId", "kind");

-- CreateIndex
CREATE INDEX "StyleAsset_generationId_idx" ON "StyleAsset"("generationId");

-- CreateIndex
CREATE INDEX "Generation_shop_createdAt_idx" ON "Generation"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "Generation_styleId_status_idx" ON "Generation"("styleId", "status");
