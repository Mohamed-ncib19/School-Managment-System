import { Global, Module } from "@nestjs/common";
import { DbService } from "./db.service";

// Global: nearly every feature module needs the database, and a module that
// forgets to import it fails at bootstrap rather than at compile time.
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}