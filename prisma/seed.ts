import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { seedAdminUser } from "./seeds/admin-user";
import { seedCatalogue } from "./seeds/catalogue";
import { seedIncrementBands } from "./seeds/increment-bands";

/*
 * Order matters: catalogue lots record which admin agreed their reserve
 * (§10), so the admin has to exist first.
 */
async function main() {
  await seedAdminUser();
  await seedCatalogue();
  await seedIncrementBands();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
