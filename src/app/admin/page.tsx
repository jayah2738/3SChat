'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, RefreshCw, Search, ShieldCheck, UserRoundCog, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase, type Profile } from '../../lib/supabaseClient';

interface AdminProfile extends Profile {
  created_at: string;
}

interface ModerationReport {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  message_content: string | null;
  message_type: string | null;
  reason: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  review_note: string | null;
  created_at: string;
}

interface AuditLog {
  id: number;
  actor_id: string | null;
  target_user_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export default function AdminPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<AdminProfile[]>([]);
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'users' | 'reports' | 'audit'>('users');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAdminData = useCallback(async () => {
    if (!user || profile?.role === 'user') return;
    setBusy(true);
    setError(null);
    const [usersResult, reportsResult, auditResult] = await Promise.all([
      supabase.from('profiles').select('id, phone_number, display_name, avatar_url, status, last_seen, role, account_status, suspension_reason, suspended_at, created_at').order('created_at', { ascending: false }).limit(300),
      supabase.from('moderation_reports').select('id, reporter_id, reported_user_id, message_content, message_type, reason, status, review_note, created_at').order('created_at', { ascending: false }).limit(200),
      supabase.from('admin_audit_logs').select('id, actor_id, target_user_id, action, details, created_at').order('created_at', { ascending: false }).limit(100),
    ]);
    const firstError = usersResult.error || reportsResult.error || auditResult.error;
    if (firstError) setError(firstError.message);
    else {
      setUsers((usersResult.data || []) as AdminProfile[]);
      setReports((reportsResult.data || []) as ModerationReport[]);
      setAuditLogs((auditResult.data || []) as AuditLog[]);
    }
    setBusy(false);
  }, [profile?.role, user]);

  useEffect(() => {
    if (loading) return;
    if (!user || profile?.role === 'user') {
      router.replace('/chat');
      return;
    }
    const timeout = setTimeout(() => void loadAdminData(), 0);
    return () => clearTimeout(timeout);
  }, [loading, loadAdminData, profile?.role, router, user]);

  const profilesById = useMemo(() => new Map(users.map((entry) => [entry.id, entry])), [users]);
  const visibleUsers = users.filter((entry) => {
    const query = search.toLowerCase();
    return entry.display_name.toLowerCase().includes(query) || entry.phone_number?.includes(search) || false;
  });
  const openReports = reports.filter((report) => report.status === 'open' || report.status === 'reviewing').length;
  const effectiveTab = profile?.role === 'moderator' ? 'reports' : tab;

  const changeStatus = async (entry: AdminProfile) => {
    const nextStatus = entry.account_status === 'active' ? 'suspended' : 'active';
    const reason = nextStatus === 'suspended' ? window.prompt(`Why should ${entry.display_name} be suspended?`) : null;
    if (nextStatus === 'suspended' && reason === null) return;
    if (!window.confirm(`${nextStatus === 'suspended' ? 'Suspend' : 'Reactivate'} ${entry.display_name}?`)) return;
    setBusy(true);
    const { error: actionError } = await supabase.rpc('admin_set_user_status', { target_user_id: entry.id, new_status: nextStatus, reason });
    if (actionError) setError(actionError.message);
    await loadAdminData();
  };

  const changeRole = async (entry: AdminProfile, role: Profile['role']) => {
    if (role === entry.role) return;
    if (!window.confirm(`Change ${entry.display_name}'s role to ${role}?`)) return;
    setBusy(true);
    const { error: actionError } = await supabase.rpc('admin_set_user_role', { target_user_id: entry.id, new_role: role });
    if (actionError) setError(actionError.message);
    await loadAdminData();
  };

  const reviewReport = async (report: ModerationReport, status: 'reviewing' | 'resolved' | 'dismissed') => {
    const note = window.prompt('Optional moderation note', report.review_note || '');
    if (note === null) return;
    setBusy(true);
    const { error: actionError } = await supabase.rpc('admin_review_report', { target_report_id: report.id, new_status: status, note });
    if (actionError) setError(actionError.message);
    await loadAdminData();
  };

  if (loading || !profile || profile.role === 'user') {
    return <div className="grid min-h-screen place-items-center bg-[#0d0e12]"><Loader2 className="h-10 w-10 animate-spin text-blue-400" /></div>;
  }

  return (
    <main className="min-h-screen bg-[#0d0e12] p-4 text-[#e9edef] md:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => router.push('/chat')} className="rounded-full p-2 text-gray-400 hover:bg-white/10 hover:text-white"><ArrowLeft className="h-5 w-5" /></button>
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-gradient"><ShieldCheck className="h-6 w-6" /></div>
            <div><h1 className="text-2xl font-bold">3SChat Administration</h1><p className="text-xs text-gray-400">Moderation actions are database-authorized and audited.</p></div>
          </div>
          <button type="button" onClick={() => void loadAdminData()} disabled={busy} className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Refresh</button>
        </header>

        {error && <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"><AlertTriangle className="h-4 w-4" />{error}</div>}

        <section className="mb-6 grid gap-4 sm:grid-cols-3">
          <Stat icon={Users} label="Users" value={users.length} />
          <Stat icon={AlertTriangle} label="Open reports" value={openReports} />
          <Stat icon={UserRoundCog} label="Suspended" value={users.filter((entry) => entry.account_status === 'suspended').length} />
        </section>

        <div className="mb-4 flex gap-2 overflow-x-auto">
          {(profile.role === 'admin' ? (['users', 'reports', 'audit'] as const) : (['reports'] as const)).map((value) => (
            <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-full px-4 py-2 text-sm font-semibold capitalize ${effectiveTab === value ? 'bg-brand-gradient text-white' : 'border border-white/10 text-gray-400 hover:text-white'}`}>{value}{value === 'reports' && openReports ? ` (${openReports})` : ''}</button>
          ))}
        </div>

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#111614] shadow-2xl">
          {effectiveTab === 'users' && <>
            <div className="border-b border-white/10 p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or phone" className="w-full rounded-xl bg-[#202c2f] py-2.5 pl-10 pr-4 text-sm outline-none focus:ring-1 focus:ring-blue-500" /></div></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-white/5 text-xs uppercase text-gray-400"><tr><th className="p-4">User</th><th className="p-4">Phone</th><th className="p-4">Role</th><th className="p-4">Status</th><th className="p-4">Last seen</th><th className="p-4">Action</th></tr></thead><tbody className="divide-y divide-white/5">{visibleUsers.map((entry) => <tr key={entry.id} className="hover:bg-white/[0.03]"><td className="p-4"><div className="font-semibold">{entry.display_name}{entry.id === user?.id ? ' (You)' : ''}</div>{entry.suspension_reason && <div className="mt-1 max-w-xs truncate text-xs text-red-300">{entry.suspension_reason}</div>}</td><td className="p-4 font-mono text-xs text-gray-300">{entry.phone_number}</td><td className="p-4"><select value={entry.role} onChange={(event) => void changeRole(entry, event.target.value as Profile['role'])} disabled={busy} className="rounded-lg border border-white/10 bg-[#202c2f] px-2 py-1.5"><option value="user">User</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select></td><td className="p-4"><StatusBadge status={entry.account_status} /></td><td className="p-4 text-xs text-gray-400">{new Date(entry.last_seen).toLocaleString()}</td><td className="p-4"><button type="button" disabled={busy || entry.id === user?.id} onClick={() => void changeStatus(entry)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-30 ${entry.account_status === 'active' ? 'bg-red-500/10 text-red-300 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'}`}>{entry.account_status === 'active' ? 'Suspend' : 'Reactivate'}</button></td></tr>)}</tbody></table></div>
          </>}

          {effectiveTab === 'reports' && <div className="divide-y divide-white/5">{reports.length ? reports.map((report) => { const reporter = profilesById.get(report.reporter_id); const reported = profilesById.get(report.reported_user_id); return <article key={report.id} className="p-5"><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{reporter?.display_name || 'Unknown'} reported {reported?.display_name || 'Unknown'}</p><p className="text-xs text-gray-500">{new Date(report.created_at).toLocaleString()}</p></div><StatusBadge status={report.status} /></div><blockquote className="mb-3 rounded-xl border-l-2 border-blue-400 bg-white/5 p-3 text-sm text-gray-300">{report.message_content || `[${report.message_type || 'deleted message'}]`}</blockquote><p className="mb-4 text-sm"><span className="text-gray-500">Reason:</span> {report.reason}</p><div className="flex flex-wrap gap-2"><button onClick={() => void reviewReport(report, 'reviewing')} className="rounded-lg bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300">Reviewing</button><button onClick={() => void reviewReport(report, 'resolved')} className="rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">Resolve</button><button onClick={() => void reviewReport(report, 'dismissed')} className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-gray-300">Dismiss</button></div></article>; }) : <Empty text="No reports have been submitted." />}</div>}

          {effectiveTab === 'audit' && <div className="divide-y divide-white/5">{auditLogs.length ? auditLogs.map((log) => <div key={log.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"><div><p className="font-medium">{log.action.replaceAll('_', ' ')}</p><p className="text-xs text-gray-500">Actor: {profilesById.get(log.actor_id || '')?.display_name || 'System'} · Target: {profilesById.get(log.target_user_id || '')?.display_name || 'N/A'}</p></div><time className="text-xs text-gray-500">{new Date(log.created_at).toLocaleString()}</time></div>) : <Empty text="No administrative actions yet." />}</div>}
        </section>
      </div>
    </main>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return <div className="rounded-2xl border border-white/10 bg-[#111614] p-5"><Icon className="mb-3 h-5 w-5 text-blue-400" /><p className="text-3xl font-bold">{value}</p><p className="text-sm text-gray-400">{label}</p></div>;
}

function StatusBadge({ status }: { status: string }) {
  const positive = status === 'active' || status === 'resolved';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${positive ? 'bg-emerald-500/10 text-emerald-300' : status === 'suspended' || status === 'open' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'}`}>{positive && <CheckCircle2 className="h-3 w-3" />}{status}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="p-12 text-center text-sm text-gray-500">{text}</div>;
}
