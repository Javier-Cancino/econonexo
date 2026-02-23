-- AlterTable
ALTER TABLE "banxico_series" ADD COLUMN     "embedding" vector(1536);

-- AlterTable
ALTER TABLE "inegi_indicadores" ADD COLUMN     "embedding" vector(1536);
