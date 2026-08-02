-- CreateTable
CREATE TABLE "hierarchy_configurations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "entityOrder" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hierarchy_configurations_pkey" PRIMARY KEY ("id")
);
