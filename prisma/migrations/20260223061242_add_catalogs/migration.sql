-- CreateTable
CREATE TABLE "inegi_indicadores" (
    "id" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,

    CONSTRAINT "inegi_indicadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banxico_series" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,

    CONSTRAINT "banxico_series_pkey" PRIMARY KEY ("id")
);
