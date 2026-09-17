import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { isAllowedOrigin } from "./common/cors-origin";
import { json } from "express";
import { AppModule } from "./app.module";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The whiteboard save path posts full Excalidraw scenes, which can embed
  // images as data URLs and regularly exceed the 100 kB Express default.
  app.use(json({ limit: "5mb" }));
  const isDev = process.env.NODE_ENV !== "production";
  const docsOn = isDev || process.env.ENABLE_API_DOCS === "true";
  app.use(
    helmet({
      // helmet's default CSP breaks the Next dev overlay and the Swagger UI's
      // inline scripts, so it stays off wherever docs are served; a production
      // API without docs ships the full default policy.
      contentSecurityPolicy: docsOn ? false : undefined,
      crossOriginEmbedderPolicy: isDev ? false : undefined,
    }),
  );
  app.enableCors({
    // Both spellings of the loopback host must pass: the frontend default API
    // URL is http://127.0.0.1:3001, and a tab opened on http://127.0.0.1:3000
    // sends that Origin. Whitelisting only `localhost` made the login POST
    // fail its preflight (OPTIONS 204, request blocked) for such tabs.
    //
    // This used to be an unanchored regex, which accepted any origin merely
    // CONTAINING a loopback address. isAllowedOrigin anchors it and adds
    // CORS_ALLOWED_ORIGINS for installs reached over a LAN.
    origin: (origin, callback) => {
      // Same-origin and non-browser callers send no Origin header at all.
      if (!origin) return callback(null, true);
      return callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
  });
  app.use(cookieParser());
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  // The docs publish the entire API surface with no authentication, which is
  // reconnaissance a self-hosted install has no reason to serve. Opt in with
  // ENABLE_API_DOCS when it is actually wanted in production.
  if (process.env.NODE_ENV !== "production" || process.env.ENABLE_API_DOCS === "true") {
    const config = new DocumentBuilder()
      .setTitle(process.env.APP_NAME ?? "school-management-api")
      .setDescription("Intern Management System API")
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, config));
  }
  // `PORT` has been documented in .env.example since the first release while
  // the port was hard-coded, so setting it did nothing and a port clash had no
  // documented way out. 3001 stays the default, which is what every existing
  // install and the frontend's default API URL already use.
  await app.listen(Number(process.env.PORT) || 3001);
}
bootstrap();
