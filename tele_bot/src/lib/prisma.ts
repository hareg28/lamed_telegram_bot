import { PrismaClient } from "@prisma/client";

export function cleanDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let url = raw.trim();

  // Strip accidental variable name if pasted into Vercel Value field
  if (url.startsWith("DATABASE_URL=")) {
    url = url.substring("DATABASE_URL=".length).trim();
  }
  if (url.startsWith("DIRECT_URL=")) {
    url = url.substring("DIRECT_URL=".length).trim();
  }

  // Strip quotes
  url = url.replace(/^["']+|["']+$/g, "").trim();

  // Ensure port 5432 if missing
  try {
    const match = url.match(/^(postgres(?:ql)?:\/\/[^@]+@)([^:\/?#]+)(\/.*)?$/);
    if (match) {
      const prefix = match[1];
      const host = match[2];
      const rest = match[3] ?? "";
      url = `${prefix}${host}:5432${rest}`;
    }
  } catch {
    // ignore
  }

  return url;
}

const cleanedDbUrl = cleanDatabaseUrl(process.env.DATABASE_URL);
if (cleanedDbUrl) {
  process.env.DATABASE_URL = cleanedDbUrl;
}
if (process.env.DIRECT_URL) {
  process.env.DIRECT_URL = cleanDatabaseUrl(process.env.DIRECT_URL);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // These help with Neon's scale-to-zero
    datasources: cleanedDbUrl
      ? {
          db: {
            url: cleanedDbUrl,
          },
        }
      : undefined,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Add a connection test function
export async function testConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    return false;
  }
}

export default prisma;