// lib/db.ts
// Общий Prisma-клиент — без этого singleton каждый API-роут в dev-режиме
// плодил бы новое подключение к базе при каждом hot reload.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
