import { BadRequestException, ConflictException } from "@nestjs/common";
import { AllExceptionsFilter } from "../filters/http-exception.filter";

const run = (exception: unknown) => {
  let statusCode = 0;
  let body: any;
  const response = {
    status: (code: number) => ({
      json: (payload: any) => {
        statusCode = code;
        body = payload;
      },
    }),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: "/api/scheduling/entries", method: "POST" }),
    }),
  } as never;
  new AllExceptionsFilter().catch(exception, host);
  return { statusCode, body };
};

describe("AllExceptionsFilter", () => {
  it("lets an explicit thrower code win over the class-derived one", () => {
    const { statusCode, body } = run(
      new ConflictException({ message: "Cette salle est déjà occupée", code: "CLASSROOM_UNAVAILABLE" }),
    );
    expect(statusCode).toBe(409);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("CLASSROOM_UNAVAILABLE");
    expect(body.error.statusCode).toBe(409);
    expect(body.error.path).toBe("/api/scheduling/entries");
  });

  it("derives the code from the exception class when none is given", () => {
    const { statusCode, body } = run(new BadRequestException("Aucun fichier téléversé"));
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toBe("Aucun fichier téléversé");
  });

  it("preserves ValidationPipe string[] messages", () => {
    const { statusCode, body } = run(
      new BadRequestException({ message: ["day_of_week must be an integer", "label is required"] } as never),
    );
    expect(statusCode).toBe(400);
    expect(body.error.message).toEqual(["day_of_week must be an integer", "label is required"]);
  });

  it("maps PG unique violations to 409 DUPLICATE_VALUE", () => {
    const { statusCode, body } = run({
      code: "23505",
      detail: "Key (email)=(a@b.c) already exists.",
    });
    expect(statusCode).toBe(409);
    expect(body.error.code).toBe("DUPLICATE_VALUE");
    expect(body.error.message).toMatch(/already exists/);
  });

  it("maps PG foreign-key violations to 400 INVALID_REFERENCE", () => {
    const { statusCode, body } = run({ code: "23503", detail: "referenced row missing" });
    expect(statusCode).toBe(400);
    expect(body.error.code).toBe("INVALID_REFERENCE");
  });

  it("falls through to 500 INTERNAL_ERROR for unknown errors", () => {
    const { statusCode, body } = run({ code: "XX000", message: "something internal" });
    expect(statusCode).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.data).toBeNull();
  });
});
