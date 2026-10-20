// Operator account administration. Passwords are typed at a hidden prompt (or piped on stdin) and never logged.
// Usage: npm run access -- provision <email> [--name "Display Name"]
//        npm run access -- disable|enable|reset-password <email>
//        npm run access -- list
import os from "node:os";
import { getAuthServices } from "../server/auth/auth";
import { disableAccess, enableAccess, listAccess, provisionUser, resetPassword } from "../server/auth/provisioning";
import { closeDb } from "../server/db/client";
import { redactConnectionStrings } from "../server/db/config";

let pipedLines: string[] | undefined;

async function readPassword(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    // Non-interactive use: one password per line on stdin.
    if (!pipedLines) {
      let text = "";
      for await (const chunk of stdin) text += chunk;
      pipedLines = text.split(/\r?\n/);
    }
    return pipedLines.shift() ?? "";
  }
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        } else if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        } else if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function newPassword(): Promise<string> {
  const first = await readPassword("New password (12-128 characters, hidden): ");
  const second = await readPassword("Repeat password: ");
  if (first !== second) throw new Error("Passwords do not match.");
  return first;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main([command, email, ...rest]: string[]): Promise<number> {
  const usage = "Usage: access provision <email> [--name NAME] | disable <email> | enable <email> | reset-password <email> | list";
  if (!command || (command !== "list" && !email)) {
    console.error(usage);
    return 2;
  }
  const services = await getAuthServices();
  switch (command) {
    case "provision": {
      const password = await newPassword();
      const result = await provisionUser(services, {
        email,
        password,
        name: option(rest, "--name"),
        operatorRef: `cli:${os.userInfo().username}`,
      });
      console.log(result.createdUser ? `Provisioned ${email.trim().toLowerCase()}; access active.` : `Account already existed; access active. Password unchanged.`);
      return 0;
    }
    case "disable":
      await disableAccess(services, email);
      console.log("Access disabled and all sessions revoked.");
      return 0;
    case "enable":
      await enableAccess(services, email);
      console.log("Access enabled.");
      return 0;
    case "reset-password":
      await resetPassword(services, email, await newPassword());
      console.log("Password replaced and all sessions revoked.");
      return 0;
    case "list":
      for (const row of await listAccess(services)) console.log(`${row.email}\t${row.state}\tenabled=${row.enabled}\tlinked=${row.linked}`);
      return 0;
    default:
      console.error(usage);
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(redactConnectionStrings(message));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
