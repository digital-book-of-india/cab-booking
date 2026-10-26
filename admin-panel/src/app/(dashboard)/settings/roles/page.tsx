'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { RbacUserItem, Role } from '@/types';
import { useAuthStore } from '@/store/auth-store';
import { Shield, UserCog, CheckCircle2, Lock } from 'lucide-react';

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
  const [saving, setSaving] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await apiClient.get('/admin/users');
      setUsers(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setSaving(true);

    try {
      await apiClient.patch(`/admin/users/${selectedUser.id}/role`, { role: targetRole });
      setSelectedUser(null);
      fetchUsers();
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

      {/* Role Reassignment Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-xs">
            <h3 className="text-base font-bold text-white">Reassign Administrative Role</h3>
            <p className="text-slate-400">
              User: <strong className="text-white">{selectedUser.name}</strong> ({selectedUser.email})
            </p>

            <form onSubmit={handleRoleChange} className="space-y-4">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-400">Select Canonical Role</label>
                <select
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value as Role)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:outline-none"
                  required
                >
                  {CANONICAL_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="px-4 py-2 font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold transition"
                >
                  {saving ? 'Updating...' : 'Confirm Role Reassignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}