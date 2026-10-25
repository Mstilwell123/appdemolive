/** Sends transactional email (sign-in links today). Implementations live behind this interface. */
export interface EmailSender {
  readonly name: string;
  sendSignInLink(input: { to: string; url: string }): Promise<void>;
}
