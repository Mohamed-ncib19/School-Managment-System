import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard, Roles } from "../auth/guards/roles.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuditService } from "../audit/audit.service";
import { FinancialSettingsService } from "./financial-settings.service";

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * The academy's brand mark — the picture that goes on the printed documents'
 * header, the browser tab and the sidebar.
 *
 * The GET route is deliberately public: the favicon is fetched by the browser
 * with no Authorization header, and the printed documents open in a bare tab.
 * A logo is not secret — it is printed on every receipt handed to parents.
 * Upload and removal stay `super_admin` only, like the rest of the settings
 * surface.
 *
 * Files live under `uploads/` next to the built app; the DB row only holds the
 * relative path, so backups of the database do not silently lose the picture.
 */
@Controller("financial/settings/logo")
export class BrandingController {
  private readonly logger = new Logger(BrandingController.name);

  constructor(
    private readonly settings: FinancialSettingsService,
    private readonly audit: AuditService,
  ) {}

  /** The uploaded logo, or 404 when none is set. */
  @Get()
  async serve(@Req() req: Request, @Res() res: Response) {
    const current = await this.settings.get();
    if (!current.logo_path) {
      return res.status(404).end();
    }
    const file = join(process.cwd(), current.logo_path);
    if (!existsSync(file)) {
      return res.status(404).end();
    }
    const ext = current.logo_path.slice(current.logo_path.lastIndexOf(".") + 1);
    const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
    res.set({
      "Content-Type": types[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      // Lets the favicon metadata version the /icon URL so browsers refetch
      // instead of serving their sticky favicon cache forever.
      "X-Logo-Version": String(new Date(current.updated_at).getTime()),
    });
    res.sendFile(file);
  }

  /** Replace (or set for the first time) the academy logo. */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_TYPES[file.mimetype]) {
          return cb(
            new BadRequestException(
              "Type d'image non pris en charge. Utilisez PNG, JPG ou WebP (le SVG n'est pas accepté).",
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser("id") userId: string) {
    if (!file) throw new BadRequestException("Aucun fichier téléversé (champ : file)");
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(`L'image doit faire moins de ${Math.floor(MAX_BYTES / 1024 / 1024)} Mo`);
    }

    const current = await this.settings.get();
    if (current.logo_path) {
      const previous = join(process.cwd(), current.logo_path);
      if (existsSync(previous)) unlinkSync(previous);
    }

    const ext = ALLOWED_TYPES[file.mimetype];
    const filename = `logo-${Date.now()}${ext}`;
    const dir = join(process.cwd(), "uploads");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(join(dir, filename));
      out.on("error", reject);
      out.on("finish", () => resolve());
      out.end(file.buffer);
    });

    const updated = await this.settings.updateLogoPath(`/uploads/${filename}`);

    await this.audit.record({
      action: "financial.logo_updated",
      entityType: "financial_settings",
      entityId: null,
      entityLabel: "Financial settings",
      actorId: userId,
      meta: { filename, bytes: file.size },
    });

    return updated;
  }

  /** Remove the logo and fall back to the text-only branding. */
  @Delete()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("super_admin")
  async remove(@CurrentUser("id") userId: string) {
    const current = await this.settings.get();
    if (!current.logo_path) {
      throw new NotFoundException("Aucun logo n'est défini");
    }

    const file = join(process.cwd(), current.logo_path);
    if (existsSync(file)) unlinkSync(file);

    const updated = await this.settings.updateLogoPath(null);

    await this.audit.record({
      action: "financial.logo_removed",
      entityType: "financial_settings",
      entityId: null,
      entityLabel: "Financial settings",
      actorId: userId,
      meta: { path: current.logo_path },
    });

    return updated;
  }
}
