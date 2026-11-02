-- Align the implicit relation table with the current Prisma schema.
ALTER TABLE "_AgentToPlan" ADD CONSTRAINT "_AgentToPlan_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_AgentToPlan_AB_unique";
