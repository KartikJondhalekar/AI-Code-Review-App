-- CreateTable
CREATE TABLE "ReviewSession" (
    "id" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "expectedChunkCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewSessionChunk" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "findingsJson" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewSessionChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewHistory" (
    "id" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "headSha" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "findingsJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewSession_repoFullName_prNumber_idx" ON "ReviewSession"("repoFullName", "prNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSessionChunk_sessionId_filePath_key" ON "ReviewSessionChunk"("sessionId", "filePath");

-- CreateIndex
CREATE INDEX "ReviewHistory_repoFullName_prNumber_idx" ON "ReviewHistory"("repoFullName", "prNumber");

-- AddForeignKey
ALTER TABLE "ReviewSessionChunk" ADD CONSTRAINT "ReviewSessionChunk_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReviewSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
