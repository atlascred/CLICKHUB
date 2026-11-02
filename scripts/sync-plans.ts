import { prisma } from "@/lib/prisma";
import { syncCommercialPlans } from "./lib/commercial-plans";

syncCommercialPlans(prisma)
  .then((plans) => console.log(JSON.stringify({ plans }, null, 2)))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
