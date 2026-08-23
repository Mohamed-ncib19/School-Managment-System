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
import { CloudSetupService } from "./setup/setup.service";
import { MachineBindingService } from "../machine/machine-binding.service";

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
    CloudSetupService,
    MachineBindingService,
  ],
  exports: [
    SyncWorkerService,
    SyncQueueService,
    CloudKeyService,
    CredentialStoreService,
  ],
})
export class CloudBackupModule {}

export { MachineBindingService };