import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { AuditService } from "../audit/audit.service";

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
      throw new BadRequestException("DATABASE_URL is not configured");
    }
    const match = dbUrl.match(/^postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
    if (!match) {
      throw new BadRequestException("DATABASE_URL is not a valid PostgreSQL connection string");
    }
    return {
      user: match[1],
      password: match[2],
      host: match[3],
      port: parseInt(match[4], 10),
      database: match[5].split("?")[0],
    };
  }

  private findBinary(name: string): string | null {
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
      const cmd = execSync(`where ${name} 2>nul`, { stdio: "pipe" });
      const result = cmd.toString().trim();
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
          const found = this.findBinaryRecursive(entry.name, name);
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

  async createBackup(version?: string): Promise<BackupResult> {
    const dbConfig = this.getDbConfig();
    const pgDump = this.findBinary("pg_dump");
    if (!pgDump) {
      throw new BadRequestException("pg_dump not found — PostgreSQL tools are not installed");
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safeVersion = version?.trim() ? version.trim() : "latest";
    const safeVersionName = safeVersion.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `iq-academy-${stamp}-${safeVersionName}.dump`;
    const target = path.join(this.backupDir, filename);

    this.logger.log(`Creating backup '${filename}' (version: ${safeVersion})`);

    const env = { ...process.env, PGPASSWORD: dbConfig.password };
    const args = `-U ${dbConfig.user} -h ${dbConfig.host} -p ${dbConfig.port} -d ${dbConfig.database} -Fc -f "${target}"`;

    try {
      execSync(`"${pgDump}" ${args}`, {
        stdio: "pipe",
        env,
        windowsHide: true,
      });
    } catch (err: any) {
      throw new BadRequestException(`pg_dump failed: ${err.message || err.stderr || err}`);
    }

    if (!fs.existsSync(target)) {
      throw new BadRequestException("Backup was not created — pg_dump reported success but produced no file");
    }

    const stat = fs.statSync(target);
    const metaPath = path.join(this.backupDir, filename + ".meta.json");
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ version: safeVersion, createdBy: "system", createdAt: new Date().toISOString() }, null, 2),
    );

    return {
      success: true,
      message: `Backup created: ${filename} (${Math.round(stat.size / 1024)} KB)`,
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

  async restoreBackup(backupId: string): Promise<RestoreResult> {
    const dumps = this.listDumpFiles();
    const dump = dumps.find((d) => d.name === backupId);
    if (!dump) {
      throw new NotFoundException(`Backup not found: ${backupId}`);
    }

    const backupPath = path.join(this.backupDir, dump.name);
    const dbConfig = this.getDbConfig();
    const pgRestore = this.findBinary("pg_restore");
    if (!pgRestore) {
      throw new BadRequestException("pg_restore not found — PostgreSQL tools are not installed");
    }

    this.logger.log(`Restoring from backup '${backupId}'`);

    const safetyResult = await this.createBackup("pre-restore-safety");
    this.logger.log(`Safety backup created: ${safetyResult.backup.filename}`);

    const env = { ...process.env, PGPASSWORD: dbConfig.password };
    const args = `-U ${dbConfig.user} -h ${dbConfig.host} -p ${dbConfig.port} -d ${dbConfig.database} --clean --if-exists --no-owner "${backupPath}"`;

    try {
      execSync(`"${pgRestore}" ${args}`, {
        stdio: "pipe",
        env,
        windowsHide: true,
      });
    } catch (err: any) {
      throw new BadRequestException(`pg_restore failed: ${err.message || err.stderr || err}`);
    }

    return {
      success: true,
      message: `Database restored from ${backupId}`,
      restoredFrom: backupId,
      safetyBackup: safetyResult.backup.filename,
    };
  }
}
