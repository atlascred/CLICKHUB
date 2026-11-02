import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { permissions } from "@/constants/permissions";

type InitialUser = {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  title?: string;
  theme?: string;
  permissions?: Prisma.InputJsonValue;
};

const defaultEmployeePermissions: Record<string, boolean> = {
  [permissions.dashboardView]: true,
  [permissions.leadsView]: true,
  [permissions.leadsCreate]: true,
  [permissions.leadsEdit]: true,
  [permissions.leadsMoveKanban]: true,
  [permissions.conversationsView]: true,
  [permissions.appointmentsView]: true,
  [permissions.appointmentsCreate]: true,
  [permissions.appointmentsEdit]: true,
  [permissions.cepsView]: true,
  [permissions.settingsView]: true,
};

const globalForInitialUsers = globalThis as typeof globalThis & {
  initialUsersEnsured?: Promise<void>;
};

export function getInitialUsers(): InitialUser[] {
  const rawUsers = process.env.INITIAL_USERS_JSON?.trim();
  if (rawUsers) {
    const parsed = JSON.parse(rawUsers) as InitialUser[];
    if (parsed.length) return parsed;
  }

  const email = process.env.ADMIN_INITIAL_EMAIL?.trim();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password) return [];

  return [{ name: "Administrador", email, password, role: "ADMIN", theme: "light", permissions: {} }];
}

export async function ensureInitialUsers() {
  const users = getInitialUsers();
  const createdUsers = [];

  for (const user of users) {
    const passwordHash = await hashPassword(user.password);
    const role = user.role ?? "EMPLOYEE";
    const theme = user.theme ?? "light";
    const normalizedEmail = user.email.toLowerCase().trim();
    const resolvedPermissions =
      role === "ADMIN" ? {} : (user.permissions ?? defaultEmployeePermissions);

    const savedUser = await prisma.user.upsert({
      where: { email: normalizedEmail },
      update: {
        name: user.name,
        passwordHash,
        role,
        status: "ACTIVE",
        deletedAt: null,
        title: user.title,
        theme,
        permissions: resolvedPermissions,
        passwordChangedAt: new Date(),
      },
      create: {
        name: user.name,
        email: normalizedEmail,
        passwordHash,
        role,
        status: "ACTIVE",
        title: user.title,
        permissions: resolvedPermissions,
        theme,
        passwordChangedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
      },
    });

    createdUsers.push(savedUser);
  }

  return createdUsers;
}

export async function ensureInitialUsersOnce() {
  if (!globalForInitialUsers.initialUsersEnsured) {
    globalForInitialUsers.initialUsersEnsured = ensureInitialUsers().then(() => undefined);
  }

  return globalForInitialUsers.initialUsersEnsured;
}
