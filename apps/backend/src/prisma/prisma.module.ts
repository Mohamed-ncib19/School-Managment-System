import { Global, Module, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

// Global: nearly every feature module needs the client, and a module that
// forgets to import it fails at bootstrap rather than at compile time.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    return this.prisma.$connect();
  }
}
