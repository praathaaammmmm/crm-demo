import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { loggerOptions } from "./logger.js";

describe("logger redaction", () => {
  it("removes cookies, authorization headers, passwords and hashes", () => {
    const lines: string[] = [];
    const logger = pino(loggerOptions("info"), {
      write: (line: string) => {
        lines.push(line);
      },
    });

    logger.info(
      {
        req: { headers: { cookie: "crm_session=COOKIE_SECRET", authorization: "Bearer AUTH_SECRET" } },
        res: { headers: { "set-cookie": "crm_session=SET_COOKIE_SECRET" } },
        body: { password: "PASSWORD_SECRET", newPassword: "NEW_PASSWORD_SECRET" },
        user: { passwordHash: "HASH_SECRET", tokenHash: "TOKEN_HASH_SECRET" },
      },
      "redaction check",
    );

    const output = lines.join("\n");
    for (const secret of [
      "COOKIE_SECRET",
      "AUTH_SECRET",
      "SET_COOKIE_SECRET",
      "PASSWORD_SECRET",
      "NEW_PASSWORD_SECRET",
      "HASH_SECRET",
      "TOKEN_HASH_SECRET",
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[redacted]");
  });
});
