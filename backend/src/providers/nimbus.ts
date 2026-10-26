import { AppError } from '../common/errors';
import type { SmsProvider } from './types';

/**
 * Text messages through an Indian DLT-registered SMS gateway (NimbusIT "SendSingleApi").
 *
 * NOT verified against the real service: the gateway's documentation was not available, so the
 * request follows the common DLT gateway shape (a GET with UserID, Password, SenderID, Phno, Msg,
 * EntityID and TemplateID). The unit tests drive it with a fake `fetch`. The first live check is one
 * real SMS to a phone you hold; if the gateway names a field differently, only this file changes.
 *
 * In India the text must match a template registered with DLT, word for word apart from its
 * variables, or the operator drops it silently. So the OTP wording comes from configuration
 * (`otpMessage`, with `{otp}`), and emergency texts are sent only when an alert template is set.
 */
export type NimbusOptions = {
  apiUrl: string;
  userId: string;
  password: string;
  senderId: string;
  entityId: string;
  otp: { templateId: string; message: string };
  /** DLT template for emergency texts. Without it, emergency texts are refused (never sent off-template). */
  alert?: { templateId: string } | undefined;
  fetchFn?: typeof fetch;
};

const FAILURE = /fail|error|invalid|denied|insufficient|not\s*allowed|reject/i;

export const DEFAULT_OTP_MESSAGE = 'Your OTP is {otp}. It is valid for 5 minutes. Do not share it.';

export function createNimbusSms(options: NimbusOptions): SmsProvider {
  const { apiUrl, userId, password, senderId, entityId } = options;
  const doFetch = options.fetchFn ?? fetch;

  async function send(phoneE164: string, message: string, templateId: string) {
    const url = new URL(apiUrl);
    url.search = new URLSearchParams({
      UserID: userId,
      Password: password,
      SenderID: senderId,
      Phno: phoneE164.replace(/^\+/, ''),
      Msg: message,
      EntityID: entityId,
      TemplateID: templateId,
    }).toString();

    let res: Response;
    try {
      res = await doFetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });
    } catch {
      // Never include the URL: it carries the gateway password.
      throw new AppError('PROVIDER_ERROR', 'The SMS gateway could not be reached.');
    }
    const text = (await res.text()).trim();
    if (!res.ok || FAILURE.test(text)) {
      throw new AppError('PROVIDER_ERROR', 'The SMS gateway did not accept the message.');
    }
    let providerMessageId = text.slice(0, 80) || 'sent';
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const id = json['MsgId'] ?? json['MessageId'] ?? json['msgid'] ?? json['Id'] ?? json['JobId'];
      if (typeof id === 'string' || typeof id === 'number') providerMessageId = String(id);
    } catch {
      // plain-text answer: keep it as the reference
    }
    return { providerMessageId };
  }

  return {
    sendOtp: (phone, otp) =>
      send(phone, options.otp.message.replace('{otp}', otp), options.otp.templateId),
    sendText: (phone, message) => {
      if (!options.alert) {
        return Promise.reject(
          new AppError('PROVIDER_ERROR', 'No approved SMS template is set for alert messages.'),
        );
      }
      return send(phone, message, options.alert.templateId);
    },
  };
}
