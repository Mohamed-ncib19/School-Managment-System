import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DataTransferModule } from "../data-transfer/data-transfer.module";
import { CloudBackupController } from "./cloud-backup.controller";
import { SyncTriggerBootstrap } from "./queue/sync-trigger-bootstrap";
import { SyncQueueService } from "./queue/sync-queue.service";
import { SyncWorkerService } from "./worker/sync-worker.service";
import { SnapshotService } from "./worker/snapshot.service";
import { InstanceRegistryService } from "./registry/instance-registry.service";
import { CloudKeyService } from "./credential-store/cloud-key.service";
import { CredentialStoreService } from "./credential-store/credential-store.service";
import { RestoreService } from "./restore/restore.service";
import { RestoreThrottleGuard } from "./restore/restore-throttle.guard";
import { RestoreLoopbackGuard } from "./restore/restore-loopback.guard";
import { CloudSetupService } from "./setup/setup.service";

@Module({
  // DataTransferModule so each snapshot can also push the Importer-compatible
  // encrypted export (`kind: "data_export"`). One direction only — the data
  // transfer side never imports this module, so there is no module cycle.
  imports: [ScheduleModule.forRoot(), DataTransferModule],
  controllers: [CloudBackupController],
  providers: [
    SyncTriggerBootstrap,
    SyncQueueService,
    SyncWorkerService,
    SnapshotService,
    InstanceRegistryService,
    CloudKeyService,
    CredentialStoreService,
    RestoreService,
    RestoreThrottleGuard,
    RestoreLoopbackGuard,
    CloudSetupService,
  ],
  exports: [
    SyncWorkerService,
    SyncQueueService,
    CloudKeyService,
    CredentialStoreService,
  ],
})
// MachineBindingService is deliberately NOT provided here. AppModule already
// provides it, and being in two modules gave it two instances — so its
// onApplicationBootstrap (which shells out to `reg query` and can call
// process.exit(1)) ran twice on every start.
export class CloudBackupModule {}