import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { createNimbusSms } from '../src/providers/nimbus';

const base = {
  apiUrl: 'https://sms.example.com/api/SmsApi/SendSingleApi',
  userId: 'acme',
  password: 'S3cret&pw',
  senderId: 'ACMEXX',
  entityId: '1700000000000001',
  otp: { templateId: '1707000000000001', message: 'Your OTP is {otp}. Valid 5 minutes.' },
};

function fakeFetch(answer: { status?: number; body: string } | Error) {
  const calls: URL[] = [];
  const fetchFn = (async (url: URL) => {
    calls.push(url);
    if (answer instanceof Error) throw answer;
    return new Response(answer.body, { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('SMS gateway adapter', () => {
  it('sends the OTP text with the registered template and the number without +', async () => {
    const { calls, fetchFn } = fakeFetch({ body: '{"Status":"Success","MsgId":"m-123"}' });
    const sms = createNimbusSms({ ...base, fetchFn });
    const res = await sms.sendOtp('+919876543210', '482913');
    expect(res.providerMessageId).toBe('m-123');
    const q = calls[0]!.searchParams;
    expect(q.get('Phno')).toBe('919876543210');
    expect(q.get('Msg')).toBe('Your OTP is 482913. Valid 5 minutes.');
    expect(q.get('TemplateID')).toBe('1707000000000001');
    expect(q.get('EntityID')).toBe('1700000000000001');
    expect(q.get('Password')).toBe('S3cret&pw'); // encoded on the wire, intact when read back
  });

  it('refuses a rejected message without leaking the password', async () => {
    const { fetchFn } = fakeFetch({ body: 'Error: Invalid template' });
    const sms = createNimbusSms({ ...base, fetchFn });
    const err = await sms.sendOtp('+919876543210', '111111').catch((e) => e);
    expect(err.code).toBe('PROVIDER_ERROR');
    expect(JSON.stringify(err.message)).not.toContain('S3cret');
    const down = createNimbusSms({ ...base, fetchFn: fakeFetch(new Error('boom S3cret')).fetchFn });
    const err2 = await down.sendOtp('+919876543210', '111111').catch((e) => e);
    expect(err2.code).toBe('PROVIDER_ERROR');
    expect(err2.message).not.toContain('S3cret');
    const http = createNimbusSms({
      ...base,
      fetchFn: fakeFetch({ status: 500, body: 'oops' }).fetchFn,
    });
    expect((await http.sendOtp('+919876543210', '1').catch((e) => e)).code).toBe('PROVIDER_ERROR');
  });

  it('sends emergency texts only when an alert template is registered', async () => {
    const none = createNimbusSms({ ...base, fetchFn: fakeFetch({ body: 'ok' }).fetchFn });
    expect((await none.sendText('+919876543210', 'Help').catch((e) => e)).code).toBe(
      'PROVIDER_ERROR',
    );
    const { calls, fetchFn } = fakeFetch({ body: 'ok-77' });
    const sms = createNimbusSms({ ...base, alert: { templateId: '1707000000000002' }, fetchFn });
    expect(
      (await sms.sendText('+919876543210', 'Asha has raised an alert')).providerMessageId,
    ).toBe('ok-77');
    expect(calls[0]!.searchParams.get('TemplateID')).toBe('1707000000000002');
  });

  it('server start-up insists on every SMS setting when real SMS is switched on', () => {
    const common = {
      NODE_ENV: 'development',
      MONGODB_URI: 'mongodb://x/y',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
    };
    expect(() => loadEnv({ ...common, SMS_DRIVER: 'nimbus' })).toThrow(/SMS_API_URL/);
    expect(() => loadEnv({ ...common })).not.toThrow();
  });
});
