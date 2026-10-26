'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Send, CheckCircle2 } from 'lucide-react';

interface NotificationTestResult {
  deliveryStatus: string;
  messageId: string;
  gatewayLatencyMs: number;
}

export default function NotificationsTestPage() {
  const [channel, setChannel] = useState<'SMS' | 'FCM_PUSH'>('FCM_PUSH');
  const [recipient, setRecipient] = useState('+919811022331');
  const [message, setMessage] = useState('Your ride OTP is 8841. Share only with driver upon pickup.');
  const [result, setResult] = useState<NotificationTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const handleTestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTesting(true);

    try {
      const res = await apiClient.post('/admin/notifications/test', {
        channel,
        recipient,
        message,
      });
      setResult(res.data.data);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Notification Gateway Testing Utility</h1>
        <p className="text-xs text-slate-400 mt-1">Simulate live provider dispatch and inspect delivery round-trip latencies.</p>
      </div>

      <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl space-y-6">
        <form onSubmit={handleTestSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold uppercase tracking-wider text-slate-400">Target Channel</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as 'SMS' | 'FCM_PUSH')}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:outline-none"
              >
                <option value="FCM_PUSH">Firebase Cloud Messaging (Push)</option>
                <option value="SMS">Twilio / Karix (SMS Gateway)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold uppercase tracking-wider text-slate-400">Recipient Phone / User ID</label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white font-mono focus:outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold uppercase tracking-wider text-slate-400">Notification Payload Message</label>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white focus:outline-none"
              required
            />
          </div>

          <button
            type="submit"
            disabled={testing}
            className="w-full flex items-center justify-center space-x-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-semibold transition"
          >
            <Send className="h-4 w-4" />
            <span>{testing ? 'Dispatching Test...' : 'Dispatch Gateway Ping'}</span>
          </button>
        </form>

        {result && (
          <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 space-y-2 text-xs text-slate-200">
            <div className="flex items-center space-x-2 text-emerald-400 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              <span>Gateway Dispatch Successful ({result.deliveryStatus})</span>
            </div>
            <p><span className="text-slate-400">Provider Message ID:</span> <code className="text-white font-mono">{result.messageId}</code></p>
            <p><span className="text-slate-400">Round-Trip Latency:</span> <strong className="text-emerald-300 font-mono">{result.gatewayLatencyMs} ms</strong></p>
          </div>
        )}
      </div>
    </div>
  );
}