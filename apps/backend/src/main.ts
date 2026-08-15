import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { json } from "express";
import { AppModule } from "./app.module";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The whiteboard save path posts full Excalidraw scenes, which can embed
  // images as data URLs and regularly exceed the 100 kB Express default.
  app.use(json({ limit: "5mb" }));
  app.enableCors({
    // Both spellings of the loopback host must pass: the frontend default API
    // URL is http://127.0.0.1:3001, and a tab opened on http://127.0.0.1:3000
    // sends that Origin. Whitelisting only `localhost` made the login POST
    // fail its preflight (OPTIONS 204, request blocked) for such tabs.
    origin: /http:\/\/(localhost|127\.0\.0\.1):\d+/,
    credentials: true,
  });
  app.use(cookieParser());
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  const config = new DocumentBuilder()
    .setTitle(process.env.APP_NAME ?? "school-management-api")
    .setDescription("Intern Management System API")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);
  // `PORT` has been documented in .env.example since the first release while
  // the port was hard-coded, so setting it did nothing and a port clash had no
  // documented way out. 3001 stays the default, which is what every existing
  // install and the frontend's default API URL already use.
  await app.listen(Number(process.env.PORT) || 3001);
}
bootstrap();
