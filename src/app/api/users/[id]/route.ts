import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { Role } from "@prisma/client";

const updateUserSchema = z.object({
  fullName: z.string().min(2, "Nome completo é obrigatório").optional(),
  email: z.string().email("E-mail inválido").optional(),
  password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres").optional(),
  role: z.nativeEnum(Role).optional(),
  allowedModels: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  if (user!.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Acesso restrito a administradores", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  const target = await db.user.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      username: true,
      email: true,
      fullName: true,
      role: true,
      allowedModels: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });

  if (!target) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  return NextResponse.json({ user: target });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
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
    const result = updateUserSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: result.error.format() },
        { status: 400 }
      );
    }

    const target = await db.user.findUnique({
      where: { id: params.id },
    });

    if (!target) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const { fullName, email, password, role, allowedModels } = result.data;

    // Email collision check
    if (email && email.toLowerCase() !== target.email.toLowerCase()) {
      const emailExists = await db.user.findUnique({
        where: { email: email.toLowerCase() },
      });
      if (emailExists) {
        return NextResponse.json(
          { error: "Este e-mail já está em uso por outro usuário." },
          { status: 409 }
        );
      }
    }

    // Protect last admin from demoting self
    if (params.id === user!.userId && role && role !== Role.ADMIN) {
      const adminCount = await db.user.count({ where: { role: Role.ADMIN } });
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Você não pode revogar seu próprio papel de administrador sendo o único administrador ativo." },
          { status: 400 }
        );
      }
    }

    const dataToUpdate: any = {};
    if (fullName) dataToUpdate.fullName = fullName.trim();
    if (email) dataToUpdate.email = email.toLowerCase().trim();
    if (role) dataToUpdate.role = role;
    if (allowedModels !== undefined) {
      dataToUpdate.allowedModels = role === Role.ADMIN ? [] : allowedModels;
    }
    if (password && password.trim().length >= 6) {
      dataToUpdate.passwordHash = await hashPassword(password.trim());
    }

    const updatedUser = await db.user.update({
      where: { id: params.id },
      data: dataToUpdate,
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        allowedModels: true,
        updatedAt: true,
      },
    });

    await logAudit({
      userId: user!.userId,
      action: "USER_UPDATED",
      entity: "USER",
      entityId: params.id,
      metadata: {
        updatedFields: Object.keys(dataToUpdate),
        newRole: updatedUser.role,
        allowedModels: updatedUser.allowedModels,
      },
    });

    return NextResponse.json({ success: true, user: updatedUser });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Erro ao atualizar usuário" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, errorResponse } = await authenticateRequest(req);
  if (errorResponse) return errorResponse;

  if (user!.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Acesso restrito a administradores", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  if (params.id === user!.userId) {
    return NextResponse.json(
      { error: "Você não pode excluir sua própria conta de administrador." },
      { status: 400 }
    );
  }

  const target = await db.user.findUnique({
    where: { id: params.id },
    select: { id: true, username: true, role: true },
  });

  if (!target) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  await db.user.delete({
    where: { id: params.id },
  });

  await logAudit({
    userId: user!.userId,
    action: "USER_DELETED",
    entity: "USER",
    entityId: params.id,
    metadata: { username: target.username, role: target.role },
  });

  return NextResponse.json({
    success: true,
    message: `Usuário '${target.username}' excluído com sucesso.`,
  });
}
