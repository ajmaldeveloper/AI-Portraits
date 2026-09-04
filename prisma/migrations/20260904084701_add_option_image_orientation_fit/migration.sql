-- CreateEnum
CREATE TYPE "StyleOptionImageOrientation" AS ENUM ('HORIZONTAL', 'VERTICAL');

-- CreateEnum
CREATE TYPE "StyleOptionImageFit" AS ENUM ('FILL', 'ORIGINAL');

-- AlterTable
ALTER TABLE "StyleOption" ADD COLUMN     "imageFit" "StyleOptionImageFit" NOT NULL DEFAULT 'FILL',
ADD COLUMN     "imageOrientation" "StyleOptionImageOrientation" NOT NULL DEFAULT 'HORIZONTAL';

