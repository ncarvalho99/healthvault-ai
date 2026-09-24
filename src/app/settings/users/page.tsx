"use client";

import React, { useEffect, useState } from "react";
import { Header } from "@/components/layout/Header";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Toast } from "@/components/ui/Toast";
import {
  Users,
  UserPlus,
  Shield,
  UserCheck,
  Trash2,
  Edit2,
  Lock,
  Cpu,
  Check,
  X,
  Sparkles,
} from "lucide-react";

interface UserItem {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: "ADMIN" | "USER";
  allowedModels: string[];
  createdAt: string;
  lastLoginAt?: string | null;
  _count?: {
    conversations: number;
    recommendations: number;
    medications: number;
  };
}

export default function UsersManagementPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [availableCombos, setAvailableCombos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);

  // Form states
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);

  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  };

  const loadData = async () => {
    try {
      const [usersRes, modelsRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/ai/models"),
      ]);

      if (!usersRes.ok) {
        throw new Error("Falha ao carregar lista de usuários (acesso restrito).");
      }

      const usersData = await usersRes.json();
      setUsers(usersData.users || []);

      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        const combos = (modelsData.models || [])
          .filter((m: any) => m.isCombo)
          .map((m: any) => m.externalId);
        // Fallback default combo set if none loaded
        const defaultCombos = [
          "exploit",
          "demigod-flash",
          "demigod-high",
          "demigod-audit",
          "claude-opus",
          "claude-sonnet",
          "github-student",
        ];
        const combined = Array.from(new Set([...combos, ...defaultCombos]));
        setAvailableCombos(combined);
      }
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openCreateModal = () => {
    setEditingUser(null);
    setUsername("");
    setEmail("");
    setFullName("");
    setPassword("");
    setRole("USER");
    setSelectedModels(["demigod-flash"]); // safe default
    setShowModal(true);
  };

  const openEditModal = (u: UserItem) => {
    setEditingUser(u);
    setUsername(u.username);
    setEmail(u.email);
    setFullName(u.fullName);
    setPassword(""); // Leave blank to preserve
    setRole(u.role);
    setSelectedModels(u.allowedModels || []);
    setShowModal(true);
  };

  const handleToggleModel = (modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId) ? prev.filter((m) => m !== modelId) : [...prev, modelId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (editingUser) {
        // Update user
        const payload: any = {
          fullName,
          email,
          role,
          allowedModels: role === "ADMIN" ? [] : selectedModels,
        };
        if (password) payload.password = password;

        const res = await fetch(`/api/users/${editingUser.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (res.ok) {
          showToast(`Usuário '${editingUser.username}' atualizado com sucesso!`, "success");
          setShowModal(false);
          loadData();
        } else {
          showToast(data.error || "Erro ao atualizar usuário", "error");
        }
      } else {
        // Create user
        const res = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            email,
            fullName,
            password,
            role,
            allowedModels: role === "ADMIN" ? [] : selectedModels,
          }),
        });

        const data = await res.json();
        if (res.ok) {
          showToast(`Usuário '${username}' criado com sucesso!`, "success");
          setShowModal(false);
          loadData();
        } else {
          showToast(data.error || "Erro ao criar usuário", "error");
        }
      }
    } catch (err: any) {
      showToast("Falha de rede ao salvar usuário", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    try {
      const res = await fetch(`/api/users/${deleteTarget.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "Usuário excluído com sucesso", "success");
        setDeleteTarget(null);
        loadData();
      } else {
        showToast(data.error || "Erro ao excluir usuário", "error");
      }
    } catch {
      showToast("Falha de rede ao excluir usuário", "error");
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
      <Header
        title="Gerenciamento de Usuários & Permissões"
        subtitle="Controle de papéis (Admin / User), isolamento de prontuário e modelos autorizados"
        actions={
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Novo Usuário</span>
          </button>
        }
      />

      <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-6">
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-xs">
            Carregando usuários do sistema...
          </div>
        ) : (
          <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800/80 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-100">Contas Registradas no HealthVault</h3>
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-mono">
                  {users.length}
                </span>
              </div>
              <span className="text-xs text-slate-400">
                Isolamento estrito: Usuários normais só acessam e excluem seus próprios registros.
              </span>
            </div>

            {/* Users Table / Cards */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/80 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Usuário</th>
                    <th className="py-3 px-4">E-mail</th>
                    <th className="py-3 px-4">Papel</th>
                    <th className="py-3 px-4">Modelos Autorizados</th>
                    <th className="py-3 px-4">Registros</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-medium">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-100">{u.fullName}</div>
                        <div className="text-[11px] font-mono text-slate-400">@{u.username}</div>
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-mono text-[11px]">
                        {u.email}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                            u.role === "ADMIN"
                              ? "bg-purple-950 text-purple-300 border border-purple-800/60"
                              : "bg-emerald-950 text-emerald-300 border border-emerald-800/60"
                          }`}
                        >
                          {u.role === "ADMIN" ? <Shield className="w-2.5 h-2.5" /> : <UserCheck className="w-2.5 h-2.5" />}
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {u.role === "ADMIN" ? (
                          <span className="text-[11px] text-purple-400 font-mono">
                            Todos os combos (Acesso Total)
                          </span>
                        ) : u.allowedModels?.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {u.allowedModels.map((m) => (
                              <span
                                key={m}
                                className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-200"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[11px] text-amber-400/80 italic">
                            Nenhum modelo liberado
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[11px] text-slate-400">
                        {u._count ? (
                          <span>
                            {u._count.conversations} chats • {u._count.medications} meds
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => openEditModal(u)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                            title="Editar permissões"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(u)}
                            className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 hover:text-white transition-colors"
                            title="Excluir usuário"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit User Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                {editingUser ? `Editar Usuário: ${editingUser.username}` : "Criar Novo Usuário"}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ex: Carlos Silva"
                    required
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-emerald-500/60"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Nome de Usuário (@handle)
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="carlos_silva"
                    disabled={Boolean(editingUser)}
                    required
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-emerald-500/60 disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  E-mail
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="carlos@exemplo.com"
                  required
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-emerald-500/60"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  {editingUser ? "Nova Senha (deixe em branco para manter a atual)" : "Senha de Acesso"}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editingUser ? "••••••••••••" : "Mínimo 6 caracteres"}
                  required={!editingUser}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-emerald-500/60"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Papel de Acesso (Role)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole("USER")}
                    className={`py-2 px-3 rounded-xl border text-left flex flex-col gap-0.5 transition-colors ${
                      role === "USER"
                        ? "bg-emerald-950/60 border-emerald-500/60 text-emerald-300 font-semibold"
                        : "bg-slate-950 border-slate-800 text-slate-400"
                    }`}
                  >
                    <span className="font-bold flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5" /> USER (Paciente/Usuário)
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Acessa apenas seus registros; modelos autorizados pelo admin.
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRole("ADMIN")}
                    className={`py-2 px-3 rounded-xl border text-left flex flex-col gap-0.5 transition-colors ${
                      role === "ADMIN"
                        ? "bg-purple-950/60 border-purple-500/60 text-purple-300 font-semibold"
                        : "bg-slate-950 border-slate-800 text-slate-400"
                    }`}
                  >
                    <span className="font-bold flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" /> ADMIN (Administrador)
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Acesso irrestrito a configurações de IA, logs, usuários e modelos.
                    </span>
                  </button>
                </div>
              </div>

              {/* Model Authorization (Only for USER role) */}
              {role === "USER" && (
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-slate-300 font-semibold flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                      Modelos de IA Autorizados
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {selectedModels.length} selecionado(s)
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    O usuário só poderá selecionar e conversar com os combos de inferência marcados abaixo:
                  </p>

                  <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto p-1 bg-slate-950 rounded-xl border border-slate-800">
                    {availableCombos.map((m) => {
                      const isChecked = selectedModels.includes(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => handleToggleModel(m)}
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-mono border transition-all text-left ${
                            isChecked
                              ? "bg-emerald-950/60 border-emerald-500/50 text-emerald-300 font-bold"
                              : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <span className="truncate">{m}</span>
                          {isChecked && <Check className="w-3 h-3 text-emerald-400 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-md shadow-emerald-950/50"
                >
                  {isSubmitting ? "Salvando..." : editingUser ? "Atualizar Usuário" : "Criar Usuário"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          isOpen={true}
          title="Excluir Usuário"
          message={`Tem certeza que deseja excluir o usuário '${deleteTarget.fullName}' (@${deleteTarget.username})? Esta ação é irreversível e excluirá todos os dados do paciente associados.`}
          confirmText="Excluir Usuário"
          cancelText="Cancelar"
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
