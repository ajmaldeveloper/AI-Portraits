-- AlterTable
ALTER TABLE "Style" ADD COLUMN     "swatchFontSizeMobilePx" INTEGER,
ADD COLUMN     "swatchFontSizePx" INTEGER,
ADD COLUMN     "swatchHeightMobilePx" INTEGER,
ADD COLUMN     "swatchHeightPx" INTEGER,
ADD COLUMN     "swatchWidthMobilePx" INTEGER,
ADD COLUMN     "swatchWidthPx" INTEGER;

-- AlterTable
ALTER TABLE "StyleOption" DROP COLUMN "swatchFontSizeMobilePx",
DROP COLUMN "swatchFontSizePx",
DROP COLUMN "swatchHeightMobilePx",
DROP COLUMN "swatchHeightPx",
DROP COLUMN "swatchWidthMobilePx",
DROP COLUMN "swatchWidthPx";

