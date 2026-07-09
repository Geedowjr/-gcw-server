import speakeasy from "speakeasy";

export function generateTotpSecret(label: string) {
  const secret = speakeasy.generateSecret({ name: `GCW (${label})`, length: 20 });
  return { base32: secret.base32, otpauthUrl: secret.otpauth_url };
}

export function verifyTotp(base32Secret: string, code: string): boolean {
  return speakeasy.totp.verify({
    secret: base32Secret,
    encoding: "base32",
    token: code,
    window: 1,
  });
}
