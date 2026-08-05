-- CreateTable
CREATE TABLE "bid_increment_bands" (
    "id" SERIAL NOT NULL,
    "from_minor" BIGINT NOT NULL,
    "increment_minor" BIGINT NOT NULL,

    CONSTRAINT "bid_increment_bands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bid_increment_bands_from_minor_key" ON "bid_increment_bands"("from_minor");
