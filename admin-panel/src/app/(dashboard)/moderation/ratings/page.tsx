'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { getErrorMessage } from '@/lib/errors';
import { useAuthStore } from '@/store/auth-store';
import {
  Star,
  RefreshCw,
  EyeOff,
  Eye,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Filter,
} from 'lucide-react';


interface ModerationRatingRow {
  ratingId: string;
  id?: string;
  rideId: string;
  raterRole?: 'CUSTOMER' | 'DRIVER';
  fromRole?: string;
  toRole?: string;
  raterName: string;
  targetName?: string;
  stars: number;
  comment?: string;
  flagged?: boolean;
  hidden?: boolean;
  tags?: string[];
  moderationStatus: 'PENDING_REVIEW' | 'APPROVED' | 'HIDDEN';
  moderationReason?: string;
  hiddenReason?: string;
  createdAt: string;
}

export default function RatingsModerationPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  // Filters
  const [maxStars, setMaxStars] = useState('2');
  const [hiddenFilter, setHiddenFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Moderation Action State
  const [targetRating, setTargetRating] = useState<ModerationRatingRow | null>(null);
  const [actionHidden, setActionHidden] = useState<boolean>(true);
  const [moderationReason, setModerationReason] = useState('Abusive language / profanity');
  const [customReason, setCustomReason] = useState('');

  // Feedback Notification
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Ratings List Query
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-ratings', { maxStars, hidden: hiddenFilter, page }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (maxStars) params.append('maxStars', maxStars);
      if (hiddenFilter) params.append('hidden', hiddenFilter);
      params.append('page', String(page));
      params.append('limit', String(limit));

      const res = await apiClient.get(`/admin/ratings?${params.toString()}`);
      return res.data?.data || res.data;
    },
  });

  const ratings: ModerationRatingRow[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  
  // Moderate / Hide Mutation
  const moderateMutation = useMutation({
    mutationFn: async ({
      ratingId,
      hidden,
      reason,
    }: {
      ratingId: string;
      hidden: boolean;
      reason: string;
    }) => {
      try {
        const res = await apiClient.patch(`/admin/ratings/${ratingId}`, {
          hidden,
          reason,
        });
        return res.data;
      } catch (err: unknown) {
        // Fallback if /moderation path is mocked
        const maybeAxios = err as { response?: { status?: number } };
        if (maybeAxios?.response?.status === 404) {
          const res = await apiClient.patch(`/admin/ratings/${ratingId}/moderation`, {
            moderationStatus: hidden ? 'HIDDEN' : 'APPROVED',
            reasonCode: reason,
          });
          return res.data;
        }
        throw err;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-ratings'] });
      setFeedback({
        type: 'success',
        message: `Rating review comment has been ${variables.hidden ? 'hidden from public display' : 'restored'}. Stars remain counted.`,
      });
      setTargetRating(null);
    },
    onError: (err: unknown) => {
      setFeedback({ type: 'error', message: getErrorMessage(err) || 'Failed to moderate review.' });
    },
  });

  const handleModerationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetRating) return;
    const finalReason = customReason.trim()
      ? `${moderationReason}: ${customReason.trim()}`
      : moderationReason;

    moderateMutation.mutate({
      ratingId: targetRating.ratingId || targetRating.id || '',
      hidden: actionHidden,
      reason: finalReason,
    });
  };

  const openModerationModal = (item: ModerationRatingRow, hide: boolean) => {
    setTargetRating(item);
    setActionHidden(hide);
    setModerationReason(
      hide ? 'Abusive language / profanity' : 'Verified customer review cleared on review'
    );
    setCustomReason('');
    setFeedback(null);
  };

  const isModerator = user?.role === 'OPS' || user?.role === 'SUPER_ADMIN';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Review & Ratings Moderation Desk
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Audit low star ratings, redact abusive feedback, and protect community guidelines while preserving ratings integrity.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          <span>Refresh Ratings</span>
        </button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <div className="flex items-center space-x-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 font-bold ml-4">
            ✕
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-xs text-xs">
        <div className="flex items-center space-x-2">
          <Filter className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-semibold text-slate-700">Filter By Stars:</span>
        </div>
        <select
          value={maxStars}
          onChange={(e) => {
            setMaxStars(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
        >
          <option value="2">Low Ratings (≤ 2 Stars)</option>
          <option value="3">Below Average (≤ 3 Stars)</option>
          <option value="5">All Star Ratings (1 - 5)</option>
        </select>

        <select
          value={hiddenFilter}
          onChange={(e) => {
            setHiddenFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-indigo-600"
        >
          <option value="">All Comments</option>
          <option value="true">Hidden Only</option>
          <option value="false">Visible Only</option>
        </select>
      </div>

      {/* Ratings Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Rating ID / Ride</th>
              <th className="px-6 py-3.5">Reviewer Role</th>
              <th className="px-6 py-3.5">Stars</th>
              <th className="px-6 py-3.5">Review Comment & Tags</th>
              <th className="px-6 py-3.5">Moderation Status</th>
              <th className="px-6 py-3.5 text-right">Operational Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  <div className="flex items-center justify-center space-x-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-indigo-600" />
                    <span>Auditing customer & driver reviews...</span>
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-rose-600">
                  {getErrorMessage(error) || 'Failed to load ratings for moderation.'}
                </td>
              </tr>
            ) : ratings.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                  Zero flagged ratings found matching the criteria.
                </td>
              </tr>
            ) : (
              ratings.map((r: ModerationRatingRow) => {
                const id = r.ratingId || r.id;
                const isHidden = r.hidden === true || r.moderationStatus === 'HIDDEN';

                return (
                  <tr key={id} className="hover:bg-slate-50/80 transition">
                    <td className="px-6 py-4 font-mono">
                      <p className="font-bold text-indigo-700">{id}</p>
                      <span className="text-slate-400 text-[11px]">{r.rideId}</span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{r.raterName || r.fromRole || 'Reviewer'}</p>
                      <span className="text-[11px] text-slate-400 uppercase font-mono">
                        {r.raterRole || r.fromRole || 'CUSTOMER'} → {r.toRole || 'DRIVER'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center font-bold text-amber-500">
                        <Star className="h-3.5 w-3.5 fill-current mr-1" />
                        {r.stars}/5
                      </span>
                    </td>
                    <td className="px-6 py-4 max-w-md">
                      <p className={`${isHidden ? 'text-slate-400 line-through italic' : 'text-slate-800'}`}>
                        {r.comment ? `"${r.comment}"` : <span className="text-slate-400 italic">No text commentary</span>}
                      </p>
                      {r.tags && r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {r.tags.map((tag: string, i: number) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-600 font-mono">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {isHidden && r.hiddenReason && (
                        <p className="text-[10px] text-rose-600 font-medium mt-1">
                          Hidden reason: {r.hiddenReason}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isHidden
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {isHidden ? 'HIDDEN' : 'VISIBLE'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      {isModerator ? (
                        isHidden ? (
                          <button
                            onClick={() => openModerationModal(r, false)}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-semibold transition"
                          >
                            <Eye className="h-3 w-3 inline mr-1" />
                            Restore
                          </button>
                        ) : (
                          <button
                            onClick={() => openModerationModal(r, true)}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-semibold transition"
                          >
                            <EyeOff className="h-3 w-3 inline mr-1" />
                            Hide Comment
                          </button>
                        )
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">Requires OPS</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Moderation Confirmation Modal */}
      {targetRating && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center space-x-3 text-indigo-700 p-3 bg-indigo-50 border border-indigo-200 rounded-xl">
              <ShieldCheck className="h-6 w-6 shrink-0 text-indigo-600" />
              <div>
                <h4 className="font-bold text-sm">
                  {actionHidden ? 'Hide Abusive Review Comment' : 'Restore Review Comment'}
                </h4>
                <p className="text-[11px] text-indigo-800 mt-0.5">
                  {actionHidden
                    ? 'Hiding suppresses offensive commentary from user apps. Note: The driver star rating will still count mathematically.'
                    : 'Restoring unhides the comment and makes it visible in driver rating summaries.'}
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <span className="text-slate-500">Review Commentary:</span>
              <p className="italic text-slate-800 font-serif">
                &quot;{targetRating.comment || 'No text'}&quot;
              </p>
              <span className="block font-bold text-amber-600 text-[11px] pt-1">
                Rating: {targetRating.stars} Stars
              </span>
            </div>

            <form onSubmit={handleModerationSubmit} className="space-y-3">
              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Policy Moderation Code *
                </label>
                <select
                  value={moderationReason}
                  onChange={(e) => setModerationReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                >
                  <option value="Abusive language / profanity">Abusive language / profanity</option>
                  <option value="Personal identifiable information (PII) leak">PII / Phone Number Leak</option>
                  <option value="Hate speech / discrimination">Hate speech / discrimination</option>
                  <option value="Commercial spam / promotional">Commercial spam / promotional</option>
                  <option value="Verified user review cleared on audit">Cleared on Audit (Unhide)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Audit Log Justification
                </label>
                <textarea
                  rows={2}
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Operational justification for audit compliance..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTargetRating(null)}
                  className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={moderateMutation.isPending}
                  className={`px-4 py-2 rounded-lg text-white font-semibold transition disabled:opacity-60 ${
                    actionHidden ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {moderateMutation.isPending ? 'Moderating...' : actionHidden ? 'Confirm Hide' : 'Confirm Restore'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
