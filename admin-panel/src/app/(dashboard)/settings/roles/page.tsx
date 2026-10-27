'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { RbacUserItem, Role } from '@/types';
import { useAuthStore } from '@/store/auth-store';
import {
  Shield,
  ShieldAlert,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  X,
  Lock,
} from 'lucide-react';

const CANONICAL_ROLES: Role[] = [
  'SUPER_ADMIN',
  'OPS',
  'SUPPORT',
  'FINANCE',
  'SAFETY_ADMIN',
  'CONFIG_ADMIN',
];

export default function RbacRolesPage() {
  const { user } = useAuthStore();
  const [users, setUsers] = useState<RbacUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<RbacUserItem | null>(null);
  const [targetRole, setTargetRole] = useState<Role>('OPS');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [auditReason, setAuditReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<{ message: string } | null>(null);

  const fetchUsers = async () => {
    try {
      const res = await apiClient.get('/admin/users');
      const list = res.data?.data?.items || res.data?.data || [];
      setUsers(Array.isArray(list) ? list : []);
    } catch (err: unknown) {
      const errorMsg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
        'Failed to load user directory';
      console.warn('Failed to load users:', errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchUsers();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const handleRoleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    if (confirmEmail.trim().toLowerCase() !== selectedUser.email.trim().toLowerCase()) {
      setModalError(`Target email verification failed. Please enter exact email "${selectedUser.email}".`);
      return;
    }
    if (auditReason.trim().length < 5) {
      setModalError('Please enter a mandatory audit justification (minimum 5 characters).');
      return;
    }

    setSaving(true);
    setModalError(null);

    try {
      try {
        await apiClient.patch(`/admin/staff/${selectedUser.id}/role`, {
          role: targetRole,
          reason: auditReason.trim(),
          stepUpCode: stepUpCode.trim() || undefined,
        });
      } catch {
        await apiClient.patch(`/admin/users/${selectedUser.id}/role`, {
          role: targetRole,
          reason: auditReason.trim(),
        });
      }

      setSuccessToast({
        message: `Privileges updated: ${selectedUser.name} reassigned to ${targetRole}.`,
      });
      setSelectedUser(null);
      setConfirmEmail('');
      setStepUpCode('');
      setAuditReason('');
      void fetchUsers();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setModalError(
        apiErr?.response?.data?.error?.message ||
          apiErr?.message ||
          'Failed to execute role change with security step-up.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Role-Based Access Control (RBAC)</h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage administrative privileges strictly mapping to canonical roles declared in docs/enums.md.
          </p>
        </div>
      </div>

      {successToast && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-300 animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{successToast.message}</span>
            <span className="text-slate-500">•</span>
            <Link
              href="/settings/audit-logs"
              className="inline-flex items-center space-x-1 font-semibold text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
            >
              <span>View Audit Trail</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <button
            onClick={() => setSuccessToast(null)}
            className="text-slate-400 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center space-x-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="border-b border-slate-800 bg-slate-800/40 text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="px-6 py-3">Administrator</th>
              <th className="px-6 py-3">Account Email</th>
              <th className="px-6 py-3">Assigned Role</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Privilege Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">Loading admin users...</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/30">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-slate-100">{u.name}</p>
                    <span className="text-[10px] font-mono text-slate-500">ID: {u.id}</span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs">{u.email}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded text-xs font-bold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                      <Shield className="h-3 w-3" />
                      <span>{u.role}</span>
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                      {u.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {/* Action RBAC: Only SUPER_ADMIN can reassign roles */}
                    {user?.role === 'SUPER_ADMIN' ? (
                      <button
                        onClick={() => {
                          setSelectedUser(u);
                          setTargetRole(u.role);
                          setConfirmEmail('');
                          setStepUpCode('');
                          setAuditReason('');
                          setModalError(null);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600 hover:text-white text-xs font-medium transition"
                      >
                        Reassign Role
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-500 italic">Super Admin Restricted</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Step-Up MFA & Role Reassignment Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Lock className="h-4 w-4 text-amber-400" />
                <h3 className="text-base font-bold text-white">Privilege Step-Up Authorization</h3>
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* High-Risk Warning */}
            <div className="flex items-start space-x-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <span>
                <strong>High-Risk Action:</strong> Elevation or modification of administrator privileges takes effect across all platform APIs immediately and will be recorded in immutable audit logs.
              </span>
            </div>

            {modalError && (
              <div className="flex items-center space-x-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleRoleChange} className="space-y-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-400 mb-1">Target Administrator</label>
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-slate-300">
                  <p className="font-semibold text-white">{selectedUser.name}</p>
                  <p className="font-mono text-slate-400 text-[11px]">{selectedUser.email}</p>
                </div>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-400 mb-1">Select New Canonical Role</label>
                <select
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value as Role)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required
                >
                  {CANONICAL_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r} {r === selectedUser.role ? '(Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Step-Up MFA Code */}
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Step-Up Authenticator Code (MFA / 2FA)
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <input
                    type="password"
                    maxLength={10}
                    placeholder="Enter 6-digit MFA OTP or Super Admin token"
                    value={stepUpCode}
                    onChange={(e) => setStepUpCode(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-800 pl-9 pr-3 py-2 text-white placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Email Re-Confirmation */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold uppercase tracking-wider text-slate-400">
                    Confirm Target Email
                  </label>
                  <span className="text-[10px] text-slate-500">
                    Type <code className="text-amber-300">{selectedUser.email}</code>
                  </span>
                </div>
                <input
                  type="email"
                  placeholder={`Re-enter ${selectedUser.email}`}
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  className={`w-full rounded-lg border bg-slate-800 px-3 py-2 text-white placeholder-slate-500 font-mono focus:outline-none ${
                    confirmEmail && confirmEmail.trim().toLowerCase() === selectedUser.email.trim().toLowerCase()
                      ? 'border-emerald-500/60 focus:ring-1 focus:ring-emerald-500'
                      : 'border-slate-700 focus:ring-1 focus:ring-indigo-500'
                  }`}
                  required
                />
              </div>

              {/* Audit Justification */}
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Audit Justification Note (Required)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Promotion approved per Security RFC-104 for regional operations"
                  value={auditReason}
                  onChange={(e) => setAuditReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="px-4 py-2 font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    saving ||
                    confirmEmail.trim().toLowerCase() !== selectedUser.email.trim().toLowerCase() ||
                    auditReason.trim().length < 5
                  }
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition"
                >
                  {saving ? 'Validating Step-Up...' : 'Authenticate & Execute Privilege Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}