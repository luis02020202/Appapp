import "server-only";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; sqliteTuned?: boolean };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// SQLite tuning: WAL lets the dashboard read while sync writes, busy_timeout
// avoids spurious "database is locked" errors. No-ops on other databases.
if (!globalForPrisma.sqliteTuned && process.env.DATABASE_URL?.startsWith("file:")) {
  globalForPrisma.sqliteTuned = true;
  void (async () => {
    try {
      await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;");
      await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000;");
    } catch (e) {
      console.warn("[db] Could not apply SQLite pragmas:", e);
    }
  })();
}
