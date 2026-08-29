-- CreateEnum
CREATE TYPE "StyleStatus" AS ENUM ('DRAFT', 'PUBLISHING', 'PUBLISHED', 'PUBLISH_ERROR', 'UNPUBLISHING', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "StyleFieldType" AS ENUM ('IMAGE', 'TEXT', 'TEXTAREA', 'SELECT', 'TOGGLE', 'NUMBER', 'DATE');

-- CreateEnum
CREATE TYPE "StyleAssetKind" AS ENUM ('REFERENCE', 'PRODUCT_GENERATED', 'PRODUCT_SELECTED', 'CUSTOMER_UPLOAD', 'CUSTOMER_RESULT');

-- CreateEnum
CREATE TYPE "GenerationPurpose" AS ENUM ('STYLE_PRODUCT', 'CUSTOMER_PREVIEW', 'CUSTOMER_FINAL');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Style" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StyleStatus" NOT NULL DEFAULT 'DRAFT',
    "prompt" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT,
    "outputAspectRatio" TEXT NOT NULL DEFAULT '1:1',
    "outputQuality" TEXT NOT NULL DEFAULT 'high',
    "previewCount" INTEGER NOT NULL DEFAULT 1,
    "generationSettings" JSONB NOT NULL,
    "productTitle" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL DEFAULT '',
    "basePrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "compareAtPrice" DECIMAL(65,30),
    "tags" JSONB NOT NULL,
    "collectionIds" JSONB NOT NULL,
    "productSettings" JSONB NOT NULL,
    "shopifyProductId" TEXT,
    "shopifyProductHandle" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Style_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleField" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "StyleFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "placeholder" TEXT,
    "helpText" TEXT,
    "defaultValue" TEXT,
    "options" JSONB,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StyleAsset" (
    "id" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "generationId" TEXT,
    "kind" "StyleAssetKind" NOT NULL,
    "storageKey" TEXT,
    "url" TEXT,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "altText" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "binaryData" BYTEA,
    "shopifyMediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "styleId" TEXT NOT NULL,
    "purpose" "GenerationPurpose" NOT NULL,
    "status" "GenerationStatus" NOT NULL DEFAULT 'QUEUED',
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
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopAIProviderSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeySecret" TEXT NOT NULL,
    "apiKeyLastFour" TEXT NOT NULL,
    "extraConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopAIProviderSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopGenerationDefaults" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "outputAspectRatio" TEXT NOT NULL DEFAULT '1:1',
    "outputQuality" TEXT NOT NULL DEFAULT 'high',
    "previewCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopGenerationDefaults_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE UNIQUE INDEX "ShopAIProviderSettings_shop_key" ON "ShopAIProviderSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ShopGenerationDefaults_shop_key" ON "ShopGenerationDefaults"("shop");

-- AddForeignKey
ALTER TABLE "StyleField" ADD CONSTRAINT "StyleField_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleAsset" ADD CONSTRAINT "StyleAsset_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StyleAsset" ADD CONSTRAINT "StyleAsset_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style"("id") ON DELETE CASCADE ON UPDATE CASCADE;
