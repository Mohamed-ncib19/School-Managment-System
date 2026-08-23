import { Injectable } from "@nestjs/common";
import { Readable } from "node:stream";
import type { StorageDriver } from "../drivers/storage-driver";
import { RedactingLogger } from "../redaction/redaction";

/**
 * Cloud-side instance registry — split-brain protection.
 *
 * Every machine mirrors this school's data, so two machines writing into the
 * same namespace would interleave event sequences and corrupt the timeline.
 * The registry (a plaintext JSON object — it holds no student data) records
 * which instance is currently active. Each instance appends its own record on
 * startup and on a heartbeat; a machine that finds ANOTHER active instance
 * refuses to sync and shows a conflict screen until a human decides which
 * machine is authoritative.
 *
 * Records are append-only and never modified in place: an instance's latest
 * record per UUID is its current state, and a retire writes a new
 * 'retired' record rather than editing the old one.
 */

export interface InstanceRecord {
  instance_uuid: string;
  hostname: string;
  claimed_at: string;
  status: "active" | "retired";
  app_version?: string;
}

export interface InstanceRegistry {
  school_id: string;
  instances: InstanceRecord[];
}

export interface ClaimResult {
  /** True when this instance is now the sole active one. */
  ok: boolean;
  /** Another active instance, when the claim collides. */
  conflict: InstanceRecord | null;
  registry: InstanceRegistry;
}

const REGISTRY_KEY = "meta/instances.json";

@Injectable()
export class InstanceRegistryService {
  private readonly logger = new RedactingLogger(InstanceRegistryService.name);

  constructor() {}

  key(schoolId: string): string {
    return `${schoolId}/${REGISTRY_KEY}`;
  }

  async read(driver: StorageDriver, schoolId: string): Promise<InstanceRegistry | null> {
    try {
      const stream = await driver.get(this.key(schoolId));
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as InstanceRegistry;
      if (parsed.school_id !== schoolId) {
        throw new Error("Registry school_id mismatch");
      }
      return parsed;
    } catch {
      return null; // not created yet
    }
  }

  async write(driver: StorageDriver, schoolId: string, registry: InstanceRegistry): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(registry, null, 2), "utf8");
    await driver.put(this.key(schoolId), streamFrom(bytes), bytes.length);
  }

  /** Appends this instance's active record and checks for a collision. */
  async claim(
    driver: StorageDriver,
    schoolId: string,
    instanceUuid: string,
    hostname: string,
    appVersion?: string,
  ): Promise<ClaimResult> {
    const current = (await this.read(driver, schoolId)) ?? { school_id: schoolId, instances: [] };

    const record: InstanceRecord = {
      instance_uuid: instanceUuid,
      hostname,
      claimed_at: new Date().toISOString(),
      status: "active",
      app_version: appVersion,
    };
    current.instances = current.instances.filter((i) => i.instance_uuid !== instanceUuid);
    current.instances.push(record);
    await this.write(driver, schoolId, current);

    const latest = latestPerInstance(current.instances);
    const conflict = latest.find((i) => i.instance_uuid !== instanceUuid && i.status === "active") ?? null;

    this.logger.log(
      conflict
        ? `Instance ${instanceUuid} claim collides with active instance ${conflict.instance_uuid}`
        : `Instance ${instanceUuid} claimed active for school ${schoolId}`,
    );
    return { ok: !conflict, conflict, registry: current };
  }

  /** Marks this instance retired (append-only; the old active record stays). */
  async retire(
    driver: StorageDriver,
    schoolId: string,
    instanceUuid: string,
  ): Promise<void> {
    const current = (await this.read(driver, schoolId)) ?? { school_id: schoolId, instances: [] };
    current.instances = current.instances.filter((i) => i.instance_uuid !== instanceUuid);
    current.instances.push({
      instance_uuid: instanceUuid,
      hostname: "",
      claimed_at: new Date().toISOString(),
      status: "retired",
    });
    await this.write(driver, schoolId, current);
  }

  /** Heartbeat: keep this instance active by re-appending its record. */
  async heartbeat(
    driver: StorageDriver,
    schoolId: string,
    instanceUuid: string,
    hostname: string,
  ): Promise<ClaimResult> {
    return this.claim(driver, schoolId, instanceUuid, hostname);
  }
}

/** Latest record per instance UUID, by claimed_at. */
export function latestPerInstance(records: InstanceRecord[]): InstanceRecord[] {
  const byUuid = new Map<string, InstanceRecord>();
  for (const r of records) {
    const existing = byUuid.get(r.instance_uuid);
    if (!existing || r.claimed_at > existing.claimed_at) byUuid.set(r.instance_uuid, r);
  }
  return [...byUuid.values()];
}

function streamFrom(bytes: Buffer): Readable {
  return Readable.from([bytes]);
}