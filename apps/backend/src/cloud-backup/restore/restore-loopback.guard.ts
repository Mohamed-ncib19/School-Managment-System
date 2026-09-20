import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Socket } from "node:net";

/**
 * The restore endpoints are unauthenticated by design: they serve the login
 * screen of a NEW machine whose old hardware is gone, so there is no session
 * to demand. That makes them the one public door into a school's database —
 * this guard narrows the door to the machine the portal itself runs on.
 *
 * Two independent checks, because neither alone is trustworthy:
 *
 *  1. Socket address. The portal proxies /api to this backend on the same
 *     host, so a legitimate restore arrives from 127.0.0.1 (or ::1). An
 *     attacker on the school LAN arrives from a LAN address. The socket
 *     address cannot be forged by the client.
 *
 *  2. X-Forwarded-For chain, when present. The Next.js proxy adds the
 *     browser's address to that header, so a request forwarded FROM the
 *     portal shows a loopback first hop. A request sent straight to :3001
 *     with a hand-written `X-Forwarded-For: 127.0.0.1` still fails check 1 —
 *     its socket is the LAN address — which is why the two checks combine
 *     into one gate instead of standing alone.
 *
 * A school that genuinely needs to restore from another computer (thin
 * client at the server, unusual network layout) sets RESTORE_ALLOW_REMOTE=true
 * in apps/backend/.env: the documented, deliberate escape hatch. The throttle
 * guard and the freshness check keep running either way.
 *
 * The message names the setting so a locked-out legitimate admin can fix it
 * without reading the source.
 */
@Injectable()
export class RestoreLoopbackGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;

    // The documented escape hatch for a school that must restore from another
    // machine (thin client at the server, unusual network layout). Anything
    // other than the exact string "true" keeps the gate closed — typos fail
    // closed. The throttle guard and the freshness check run either way.
    const remoteAllowed = process.env.RESTORE_ALLOW_REMOTE?.trim().toLowerCase() === "true";
    if (remoteAllowed) return true;

    const request = context.switchToHttp().getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
      headers?: Record<string, string | string[] | undefined>;
    }>();

    const socketAddress = request.socket?.remoteAddress ?? request.ip ?? "";
    if (!isLoopback(socketAddress)) {
      throw restoreRefused(socketAddress);
    }

    const forwarded = request.headers?.["x-forwarded-for"];
    const chain = typeof forwarded === "string" ? forwarded : Array.isArray(forwarded) ? forwarded.join(",") : "";
    const firstHop = chain.split(",")[0]?.trim();
    if (firstHop && !isLoopback(firstHop)) {
      throw restoreRefused(socketAddress);
    }

    return true;
  }
}

function restoreRefused(socketAddress: string): HttpException {
  return new HttpException(
    {
      message:
        "La restauration n'est possible que depuis l'ordinateur du serveur (ou avec RESTORE_ALLOW_REMOTE=true dans apps/backend/.env).",
      code: "RESTORE_LOCAL_ONLY",
      from: socketAddress,
    },
    HttpStatus.FORBIDDEN,
  );
}

/** Loopback in every family spelling an OS hands us: v4, v6, IPv4-mapped v6. */
export function isLoopback(address: string): boolean {
  if (!address) return false;
  const a = address.replace(/^::ffff:/i, "");
  return a === "::1" || a === "127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}
