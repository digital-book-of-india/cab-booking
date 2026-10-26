'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { ReviewRatingItem } from '@/types';
import { Star } from 'lucide-react';

export default function RatingsModerationPage() {
  const [ratings, setRatings] = useState<ReviewRatingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRatings = async () => {
    try {
      const res = await apiClient.get('/admin/ratings');
      setRatings(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRatings();
  }, []);

  const handleModeration = async (id: string, moderationStatus: 'APPROVED' | 'HIDDEN') => {
    await apiClient.patch(`/admin/ratings/${id}/moderation`, {
      moderationStatus,
      reasonCode: moderationStatus === 'HIDDEN' ? 'COMMUNITY_POLICY_VIOLATION' : 'VERIFIED_FEEDBACK',
    });
    fetchRatings();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Review & Ratings Moderation Desk</h1>
        <p className="text-xs text-slate-500 mt-1">Review flagged feedback, inappropriate language, and verify driver star ratings.</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        <table className="w-full text-left text-sm text-slate-700">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-6 py-3.5">Rating / Ride</th>
              <th className="px-6 py-3.5">Rater</th>
              <th className="px-6 py-3.5">Stars</th>
              <th className="px-6 py-3.5">Feedback Comment</th>
              <th className="px-6 py-3.5">Moderation</th>
              <th className="px-6 py-3.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-400">Checking flagged ratings...</td></tr>
            ) : (
              ratings.map((r) => (
                <tr key={r.ratingId} className="hover:bg-slate-50/80 transition">
                  <td className="px-6 py-4 font-mono text-xs">
                    <p className="text-indigo-700 font-bold">{r.ratingId}</p>
                    <span className="text-slate-400">{r.rideId}</span>
                  </td>
                  <td className="px-6 py-4 text-xs">
                    <p className="font-semibold text-slate-900">{r.raterName}</p>
                    <span className="text-[11px] text-slate-500">{r.raterRole}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center text-amber-500 font-bold text-xs">
                      <Star className="h-3.5 w-3.5 fill-current mr-1" />
                      {r.stars}/5
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-700 max-w-sm">
                    {r.comment || <span className="text-slate-400 italic">No text comment</span>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      r.moderationStatus === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {r.moderationStatus}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button
                      onClick={() => handleModeration(r.ratingId, 'APPROVED')}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-xs font-semibold transition"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleModeration(r.ratingId, 'HIDDEN')}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 text-xs font-semibold transition"
                    >
                      Hide
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}