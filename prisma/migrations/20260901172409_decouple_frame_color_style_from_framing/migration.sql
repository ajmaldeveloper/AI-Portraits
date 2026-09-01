/*
  Warnings:

  - You are about to drop the column `frameColorId` on the `StyleFramingOption` table. All the data in the column will be lost.
  - You are about to drop the column `frameStyleId` on the `StyleFramingOption` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "StyleFramingOption" DROP CONSTRAINT "StyleFramingOption_frameColorId_fkey";

-- DropForeignKey
ALTER TABLE "StyleFramingOption" DROP CONSTRAINT "StyleFramingOption_frameStyleId_fkey";

-- DropIndex
DROP INDEX "StyleFramingOption_frameColorId_idx";

-- DropIndex
DROP INDEX "StyleFramingOption_frameStyleId_idx";

-- AlterTable
ALTER TABLE "StyleFramingOption" DROP COLUMN "frameColorId",
DROP COLUMN "frameStyleId";
