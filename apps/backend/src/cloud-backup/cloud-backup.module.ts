import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
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
import { CloudSetupService } from "./setup/setup.service";

@Module({
  imports: [ScheduleModule.forRoot()],
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