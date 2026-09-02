-- DropForeignKey
ALTER TABLE "StyleFrameColor" DROP CONSTRAINT "StyleFrameColor_styleId_fkey";

-- DropForeignKey
ALTER TABLE "StyleFrameStyle" DROP CONSTRAINT "StyleFrameStyle_styleId_fkey";

-- AlterTable
ALTER TABLE "StyleFramingOption" ADD COLUMN     "frameColor" TEXT;

-- DropTable
DROP TABLE "StyleFrameColor";

-- DropTable
DROP TABLE "StyleFrameStyle";

