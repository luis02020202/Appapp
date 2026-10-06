import { randomBytes } from "node:crypto";

// Prints a fresh 256-bit key for TOKEN_ENCRYPTION_KEY.
console.log(randomBytes(32).toString("base64"));
