import { useState, useEffect } from 'react';
import { Users, Shield, Eye, Trash2, Plus, Mail } from 'lucide-react';
import { useAuth } from '../lib/auth';
import {
  getAllProfiles,
  updateProfile,
  getInvitedUsers,
  addInvitedUser,
  removeInvitedUser,
} from '../lib/firestore-helpers';

const ROLES = [
  { value: 'admin', label: '管理者', icon: Shield, color: 'text-red-600 bg-red-50' },
  { value: 'operator', label: 'オペレーター', icon: Users, color: 'text-blue-600 bg-blue-50' },
  { value: 'viewer', label: '閲覧者', icon: Eye, color: 'text-cream-600 bg-cream-100' },
];

export default function AdminPanel() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('operator');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [profileData, inviteData] = await Promise.all([
        getAllProfiles(),
        getInvitedUsers(),
      ]);
      setProfiles(profileData);
      setInvites(inviteData);
    } catch {
      // エラー時は空配列
    }
    setLoading(false);
  };

  const changeRole = async (uid, newRole) => {
    if (uid === user.uid) return;
    await updateProfile(uid, { role: newRole });
    setProfiles((prev) =>
      prev.map((p) => (p.id === uid ? { ...p, role: newRole } : p))
    );
  };

  const handleAddInvite = async (e) => {
    e.preventDefault();
    setInviteError('');
    const email = inviteEmail.toLowerCase().trim();
    if (!email) return;

    // 重複チェック
    if (invites.some((i) => i.email === email)) {
      setInviteError('このメールアドレスはすでに登録されています');
      return;
    }
    // 既存ユーザーチェック
    if (profiles.some((p) => p.email?.toLowerCase() === email)) {
      setInviteError('このメールアドレスはすでにアカウントが存在します（ユーザー管理から権限変更してください）');
      return;
    }

    setInviteLoading(true);
    try {
      await addInvitedUser({ email, role: inviteRole, invitedBy: user.email });
      setInviteEmail('');
      await loadAll();
    } catch {
      setInviteError('登録に失敗しました');
    }
    setInviteLoading(false);
  };

  const handleRemoveInvite = async (docId) => {
    await removeInvitedUser(docId);
    setInvites((prev) => prev.filter((i) => i.id !== docId));
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">

      {/* ===== 既存ユーザー管理 ===== */}
      <div>
        <h2 className="font-heading font-bold text-xl text-cream-900 mb-5">
          ユーザー管理
        </h2>
        <div className="bg-white rounded-xl border border-cream-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full mx-auto" />
            </div>
          ) : profiles.length === 0 ? (
            <p className="p-8 text-center text-sm font-body text-cream-400">ユーザーなし</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-cream-50">
                  <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">ユーザー</th>
                  <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">メール</th>
                  <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">権限</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => {
                  const role = ROLES.find((r) => r.value === p.role) || ROLES[2];
                  const isSelf = p.id === user.uid;
                  return (
                    <tr key={p.id} className="border-t border-cream-100 hover:bg-cream-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {p.photoURL ? (
                            <img src={p.photoURL} alt="" className="w-8 h-8 rounded-full" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-cream-200 flex items-center justify-center text-cream-500 text-sm font-heading">
                              {(p.displayName || p.email || '?')[0]}
                            </div>
                          )}
                          <span className="text-sm font-body text-cream-800">
                            {p.displayName || '名前未設定'}
                            {isSelf && <span className="ml-2 text-xs text-cream-400">(自分)</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-cream-600">{p.email}</td>
                      <td className="px-4 py-3">
                        {isSelf ? (
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-body ${role.color}`}>
                            <role.icon size={12} />
                            {role.label}
                          </span>
                        ) : (
                          <select
                            value={p.role}
                            onChange={(e) => changeRole(p.id, e.target.value)}
                            className="text-sm font-body border border-cream-200 rounded-lg px-2 py-1.5 bg-white text-cream-800 focus:outline-none focus:ring-2 focus:ring-accent/30"
                          >
                            {ROLES.map((r) => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ===== 事前登録 ===== */}
      <div>
        <h2 className="font-heading font-bold text-xl text-cream-900 mb-1">
          事前登録
        </h2>
        <p className="text-sm font-body text-cream-500 mb-5">
          メールアドレスと権限を登録しておくと、初回ログイン時に自動でロールが付与されます。
        </p>

        {/* 追加フォーム */}
        <form onSubmit={handleAddInvite} className="bg-white rounded-xl border border-cream-200 shadow-sm p-5 mb-4">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs font-heading font-semibold text-cream-600 mb-1.5">メールアドレス</label>
              <div className="flex items-center gap-2 border border-cream-200 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-accent/30 bg-white">
                <Mail size={14} className="text-cream-400 shrink-0" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => { setInviteEmail(e.target.value); setInviteError(''); }}
                  placeholder="user@example.com"
                  className="flex-1 text-sm font-body text-cream-800 outline-none bg-transparent"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-heading font-semibold text-cream-600 mb-1.5">権限</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="text-sm font-body border border-cream-200 rounded-lg px-3 py-2 bg-white text-cream-800 focus:outline-none focus:ring-2 focus:ring-accent/30"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={inviteLoading}
              className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-dark text-white text-sm rounded-lg font-heading font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              <Plus size={15} />
              {inviteLoading ? '登録中...' : '追加'}
            </button>
          </div>
          {inviteError && (
            <p className="mt-2 text-xs font-body text-red-600">{inviteError}</p>
          )}
        </form>

        {/* 登録済みリスト */}
        <div className="bg-white rounded-xl border border-cream-200 shadow-sm overflow-hidden">
          {invites.length === 0 ? (
            <p className="p-8 text-center text-sm font-body text-cream-400">事前登録なし</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-cream-50">
                  <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">メール</th>
                  <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">権限</th>
                  <th className="px-4 py-3 text-left text-xs font-heading font-semibold text-cream-500">登録者</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => {
                  const role = ROLES.find((r) => r.value === inv.role) || ROLES[2];
                  return (
                    <tr key={inv.id} className="border-t border-cream-100 hover:bg-cream-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm font-mono text-cream-700">{inv.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-body ${role.color}`}>
                          <role.icon size={12} />
                          {role.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-body text-cream-400">{inv.invitedBy || '-'}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleRemoveInvite(inv.id)}
                          className="text-cream-300 hover:text-red-500 transition-colors"
                          title="削除"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ===== 権限一覧 ===== */}
      <div className="bg-cream-50 rounded-xl border border-cream-200 p-4">
        <h3 className="font-heading font-semibold text-sm text-cream-800 mb-2">権限一覧</h3>
        <table className="w-full text-xs font-body">
          <thead>
            <tr className="text-cream-500">
              <th className="text-left py-1">ロール</th>
              <th className="text-center py-1">セッション実行</th>
              <th className="text-center py-1">設定変更</th>
              <th className="text-center py-1">ユーザー管理</th>
            </tr>
          </thead>
          <tbody className="text-cream-700">
            <tr>
              <td className="py-1">管理者 (admin)</td>
              <td className="text-center">OK</td>
              <td className="text-center">OK</td>
              <td className="text-center">OK</td>
            </tr>
            <tr>
              <td className="py-1">オペレーター (operator)</td>
              <td className="text-center">OK</td>
              <td className="text-center">--</td>
              <td className="text-center">--</td>
            </tr>
            <tr>
              <td className="py-1">閲覧者 (viewer)</td>
              <td className="text-center">--</td>
              <td className="text-center">--</td>
              <td className="text-center">--</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
