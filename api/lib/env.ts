import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

export const env = {
  // Secret used to sign session JWTs and hash-compare passwords' tokens.
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  // The account that signs up with this email is auto-granted admin (first admin).
  ownerEmail: process.env.OWNER_EMAIL ?? "",
};
