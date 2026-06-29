import { randomInt } from "node:crypto";

const alphabet =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!?#$%";

export function generateTemporaryPassword(length = 18) {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join(
    "",
  );
}
