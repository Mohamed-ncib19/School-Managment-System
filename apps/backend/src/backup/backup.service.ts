import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { AuditService } from "../audit/audit.service";
import { parsePgUrl } from "../common/pg-url";

const execFileP = promisify(execFile);

/**
 * How long a dump or restore may run before it is killed.
 *
 * Without a ceiling a `pg_dump` blocked on a lock waits forever, and the only
 * symptom is a request that never returns.
 */
const PG_TIMEOUT_MS = 30 * 60_000;

/** Dumps can be large; give the child enough room to report its own errors. */
const PG_MAX_BUFFER = 64 * 1024 * 1024;

interface BackupRecord {
  id: string;
  filename: string;
  size: number;
  createdAt: string;
  createdBy: string | null;
  version: string | null;
  recordCount: Record<string, number> | null;
}

export interface BackupResult {
  success: boolean;
  message: string;
  backup: {
    id: string;
    filename: string;
    path: string;
    size: number;
    createdAt: string;
    version: string | null;
  };
}

export interface RestoreResult {
  success: boolean;
  message: string;
  restoredFrom: string;
  safetyBackup: string | null;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupDir: string;

  constructor(private readonly audit: AuditService) {
    const root = process.cwd().includes("apps/backend")
      ? process.cwd().split("apps/backend")[0]
      : path.resolve(process.cwd(), "..");
    this.backupDir = path.join(root, "backups");
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  private getDbConfig() {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new BadRequestException("DATABASE_URL n'est pas configurée");
    }
    // The old regex rejected the postgres:// scheme, required a port, broke
    // on passwords containing '@' and never percent-decoded — the wizard
    // generates random passwords, so that case is real. parsePgUrl (tested
    // in common/__tests__/pg-url.spec.ts) handles all of it.
    try {
      return parsePgUrl(dbUrl);
    } catch {
      throw new BadRequestException("DATABASE_URL n'est pas une chaîne de connexion PostgreSQL valide");
    }
  }

  private async findBinary(name: string): Promise<string | null> {
    const candidates = [
      path.join(process.cwd(), ".postgres", "runtime"),
      "C:\\Program Files\\PostgreSQL",
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const found = this.findBinaryRecursive(candidate, name);
        if (found) return found;
      }
    }

    try {
      const { stdout } = await execFileP("where", [name], { windowsHide: true });
      const result = stdout.trim();
      if (result) return result.split("\n")[0].trim();
    } catch {
      // binary not found on PATH
    }

    return null;
  }

  private findBinaryRecursive(dir: string, name: string): string | null {
    const target = path.join(dir, `${name}.exe`);
    if (fs.existsSync(target)) return target;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // The child must be joined onto `dir`: recursing on the bare entry
          // name resolves it against the process cwd instead, so the search
          // never actually descended and the bundled binaries were never found.
          const found = this.findBinaryRecursive(path.join(dir, entry.name), name);
          if (found) return found;
        }
      }
    } catch {
      // permission error or not a directory
    }

    return null;
  }

  private listDumpFiles(): { name: string; dir: string; stat: fs.Stats }[] {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs.readdirSync(this.backupDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".dump"))
      .map((dirent) => ({
        name: dirent.name,
        dir: this.backupDir,
        stat: fs.statSync(path.join(this.backupDir, dirent.name)),
      }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  }

  private parseMeta(filename: string): { version: string | null; createdBy: string | null } {
    const metaPath = path.join(this.backupDir, filename + ".meta.json");
    if (fs.existsSync(metaPath)) {
      try {
        return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      } catch {
        // fall through to defaults
      }
    }
    return { version: null, createdBy: null };
  }

  async listBackups(): Promise<BackupRecord[]> {
    const dumps = this.listDumpFiles();

    return dumps.map((dump) => {
      const meta = this.parseMeta(dump.name);
      return {
        id: dump.name,
        filename: dump.name,
        size: dump.stat.size,
        createdAt: dump.stat.mtime.toISOString(),
        createdBy: meta.createdBy,
        version: meta.version,
        recordCount: null,
      };
    });
  }

  async createBackup(version?: string, actorUserId?: string | null): Promise<BackupResult> {
    const dbConfig = this.getDbConfig();
    const pgDump = await this.findBinary("pg_dump");
    if (!pgDump) {
      throw new BadRequestException("pg_dump introuvable — les outils PostgreSQL ne sont pas installés");
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safeVersion = version?.trim() ? version.trim() : "latest";
    const safeVersionName = safeVersion.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `iq-academy-${stamp}-${safeVersionName}.dump`;
    const target = path.join(this.backupDir, filename);

    this.logger.log(`Creating backup '${filename}' (version: ${safeVersion})`);

    const env = { ...process.env, PGPASSWORD: dbConfig.password };
    // Passed as argv rather than a shell string: `execFile` never spawns a
    // shell, so a database or host name containing a shell metacharacter is
    // an argument rather than a command.
    const args = [
      "-U", dbConfig.user,
      "-h", dbConfig.host,
      "-p", String(dbConfig.port),
      "-d", dbConfig.database,
      "-Fc",
      "-f", target,
    ];

    try {
      await execFileP(pgDump, args, {
        env,
        windowsHide: true,
        timeout: PG_TIMEOUT_MS,
        maxBuffer: PG_MAX_BUFFER,
      });
    } catch (err: any) {
      throw new BadRequestException(`Échec de pg_dump : ${err.stderr || err.message || err}`);
    }

    if (!fs.existsSync(target)) {
      throw new BadRequestException("La sauvegarde n'a pas été créée — pg_dump a réussi mais n'a produit aucun fichier");
    }

    const stat = fs.statSync(target);
    const metaPath = path.join(this.backupDir, filename + ".meta.json");
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ version: safeVersion, createdBy: "system", createdAt: new Date().toISOString() }, null, 2),
    );

    await this.audit.record({
      action: "backup.created",
      entityType: "backup",
      entityLabel: filename,
      actorId: actorUserId ?? null,
      meta: { version: safeVersion, size: stat.size },
    });

    return {
      success: true,
      message: `Sauvegarde créée : ${filename} (${Math.round(stat.size / 1024)} Ko)`,
      backup: {
        id: filename,
        filename,
        path: target,
        size: stat.size,
        createdAt: new Date().toISOString(),
        version: safeVersion,
      },
    };
  }

  async restoreBackup(backupId: string, actorUserId?: string | null): Promise<RestoreResult> {
    const dumps = this.listDumpFiles();
    const dump = dumps.find((d) => d.name === backupId);
    if (!dump) {
      throw new NotFoundException(`Sauvegarde introuvable : ${backupId}`);
    }

    const backupPath = path.join(this.backupDir, dump.name);
    const dbConfig = this.getDbConfig();
    const pgRestore = await this.findBinary("pg_restore");
    if (!pgRestore) {
      throw new BadRequestException("pg_restore introuvable — les outils PostgreSQL ne sont pas installés");
    }

    this.logger.log(`Restoring from backup '${backupId}'`);

    const safetyResult = await this.createBackup("pre-restore-safety", actorUserId);
    this.logger.log(`Safety backup created: ${safetyResult.backup.filename}`);

    const env = { ...process.env, PGPASSWORD: dbConfig.password };
    const args = [
      "-U", dbConfig.user,
      "-h", dbConfig.host,
      "-p", String(dbConfig.port),
      "-d", dbConfig.database,
      "--clean", "--if-exists", "--no-owner",
      backupPath,
    ];

    try {
      await execFileP(pgRestore, args, {
        env,
        windowsHide: true,
        timeout: PG_TIMEOUT_MS,
        maxBuffer: PG_MAX_BUFFER,
      });
    } catch (err: any) {
      throw new BadRequestException(`Échec de pg_restore : ${err.stderr || err.message || err}`);
    }

    await this.audit.record({
      action: "backup.restored",
      entityType: "backup",
      entityLabel: backupId,
      actorId: actorUserId ?? null,
      meta: { restored_from: backupId, safety_backup: safetyResult.backup.filename },
    });

    return {
      success: true,
      message: `Base de données restaurée depuis ${backupId}`,
      restoredFrom: backupId,
      safetyBackup: safetyResult.backup.filename,
    };
  }
}
