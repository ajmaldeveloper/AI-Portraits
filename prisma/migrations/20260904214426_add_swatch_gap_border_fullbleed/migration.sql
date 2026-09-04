-- AlterTable
ALTER TABLE "Style" ADD COLUMN     "swatchActiveBorderColor" TEXT,
ADD COLUMN     "swatchBorderColor" TEXT,
ADD COLUMN     "swatchFullBleed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "swatchGapPx" INTEGER;

