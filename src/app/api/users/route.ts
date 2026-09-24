import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { Role } from "@prisma/client";

const createUserSchema = z.object({
  username: z
    .string()
    .min(3, "Nome de usuário deve ter pelo menos 3 caracteres")
    .regex(/^[a-zA-Z0-9_-]+$/, "Nome de usuário deve conter apenas letras, números e _ -"),
  email: z.string().email("E-mail inválido"),
  fullName: z.string().min(2, "Nome completo é obrigatório"),
  password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres"),
  role: z.nativeEnum(Role).default(Role.USER),
  allowedModels: z.array(z.string()).optional().default([]),
});

export async function GET(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  if (user!.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Acesso restrito a administradores", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const users = await db.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      fullName: true,
      role: true,
      allowedModels: true,
      createdAt: true,
      lastLoginAt: true,
      _count: {
        select: {
          conversations: true,
          recommendations: true,
          medications: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  if (user!.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Acesso restrito a administradores", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const result = createUserSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: result.error.format() },
        { status: 400 }
      );
    }

    const { username, email, fullName, password, role, allowedModels } = result.data;

    // Check unique username and email
    const existing = await db.user.findFirst({
      where: {
        OR: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }],
      },
    });

    if (existing) {
      const field = existing.username === username.toLowerCase() ? "Nome de usuário" : "E-mail";
      return NextResponse.json(
        { error: `${field} já está em uso por outra conta.` },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    const newUser = await db.user.create({
      data: {
        username: username.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
        fullName: fullName.trim(),
        passwordHash,
        role,
        allowedModels: role === Role.ADMIN ? [] : allowedModels,
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        allowedModels: true,
        createdAt: true,
      },
    });

    await logAudit({
      userId: user!.userId,
      action: "USER_CREATED",
      entity: "USER",
      entityId: newUser.id,
      metadata: {
        createdUsername: newUser.username,
        role: newUser.role,
        allowedModels: newUser.allowedModels,
      },
    });

    return NextResponse.json({ success: true, user: newUser }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Erro ao criar usuário" },
      { status: 500 }
    );
  }
}
