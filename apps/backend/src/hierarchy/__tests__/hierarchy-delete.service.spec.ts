import { ConflictException, BadRequestException } from "@nestjs/common";
import { HierarchyDeleteService } from "../hierarchy-delete.service";
import { AuditService } from "../../audit/audit.service";
import { DbService } from "../../db/db.service";

jest.mock("../../db/db.service");
jest.mock("../../audit/audit.service");

const mockRow = (overrides: any = {}) => ({
  id: overrides.id ?? "mock-id",
  name: "Mock",
  full_name: "Mock",
  is_active: true,
  ...overrides,
});

describe("HierarchyDeleteService", () => {
  let service: HierarchyDeleteService;
  let mockDbClient: any;
  let mockAudit: jest.Mocked<AuditService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDbClient = {
      query: {
        levels: { findFirst: jest.fn(), findMany: jest.fn() },
        fields: { findFirst: jest.fn(), findMany: jest.fn() },
        professors: { findFirst: jest.fn(), findMany: jest.fn() },
        groups: { findFirst: jest.fn(), findMany: jest.fn() },
        students: { findFirst: jest.fn(), findMany: jest.fn() },
      },
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([])),
          innerJoin: jest.fn(() => Promise.resolve([])),
        })),
        then: (resolve: any) => resolve([]),
      })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => Promise.resolve([])),
        })),
      })),
      delete: jest.fn(() => ({ where: jest.fn(() => Promise.resolve({ rowCount: 0 })) })),
      transaction: jest.fn(async (cb: any) => cb({
        select: jest.fn(() => ({
          from: jest.fn(() => ({
            where: jest.fn(() => Promise.resolve([{ id: "prof-2", is_active: true, field_id: "field-1" }])),
            innerJoin: jest.fn(() => Promise.resolve([])),
          })),
          then: (resolve: any) => resolve([{ id: "prof-2", is_active: true, field_id: "field-1" }]),
        })),
        update: jest.fn(() => ({
          set: jest.fn(() => ({
            where: jest.fn(() => Promise.resolve([])),
          })),
        })),
        delete: jest.fn(() => ({ where: jest.fn(() => Promise.resolve({ rowCount: 0 })) })),
      })),
    };

    mockAudit = { record: jest.fn() } as any;

    const DbServiceMock = DbService as jest.MockedClass<typeof DbService>;
    DbServiceMock.mockImplementation(() => ({ client: mockDbClient }) as any);

    service = new HierarchyDeleteService({ client: mockDbClient } as any, mockAudit);
  });

  describe("archiveCascade", () => {
    it("should throw ConflictException if node is already archived", async () => {
      mockDbClient.query.fields.findFirst = jest.fn().mockResolvedValue(mockRow({ id: "field-1", is_active: false }));
      await expect(service.archiveCascade("field", "field-1")).rejects.toThrow(ConflictException);
    });

    it("should archive target and descendants and record audit", async () => {
      mockDbClient.query.fields.findFirst = jest.fn().mockResolvedValue(mockRow({ id: "field-1", name: "CS", is_active: true }));
      mockDbClient.query.professors.findMany = jest.fn().mockResolvedValue([mockRow({ id: "prof-1", full_name: "Prof A" })]);
      mockDbClient.query.groups.findMany = jest.fn().mockResolvedValue([mockRow({ id: "group-1", name: "Group A" })]);

      const deleteImpactSpy = jest.spyOn(service as any, "deleteImpact").mockResolvedValue({
        level: 0, field: 1, professor: 1, group: 1, student: 0, directChildren: [],
      });

      const result = await service.archiveCascade("field", "field-1", "user-1");
      expect(result.affected.field).toBe(1);
      expect(result.affected.professor).toBe(1);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "field.archive_cascade", entityId: "field-1" }),
      );

      deleteImpactSpy.mockRestore();
    });
  });

  describe("deleteImpact", () => {
    it("should return zero counts for a leaf group", async () => {
      const spy = jest.spyOn(service as any, "deleteImpact").mockResolvedValue({
        level: 0, field: 0, professor: 0, group: 1, student: 0, directChildren: [],
      });
      const impact = await service.deleteImpact("group", "group-1");
      expect(impact.group).toBe(1);
      expect(impact.student).toBe(0);
      spy.mockRestore();
    });
  });

  describe("detachAndDelete", () => {
    const impactStub = {
      level: 0,
      field: 0,
      professor: 1,
      group: 1,
      student: 0,
      directChildren: [{ id: "group-1", name: "Group A", type: "group" }],
    };

    beforeEach(() => {
      const spy = jest.spyOn(service as any, "deleteImpact").mockResolvedValue(impactStub);
      (service as any)._deleteImpactSpy = spy;
    });

    afterEach(() => {
      if ((service as any)._deleteImpactSpy) {
        (service as any)._deleteImpactSpy.mockRestore();
      }
    });

    /**
     * A level detach used to be refused outright ("Level cannot be detached -
     * it has no parent"). That confused the level with its children: the level
     * itself is not being re-pointed, its fields are, and a field can move to
     * any other level. The dialog offered the option regardless, so the refusal
     * surfaced as a 400 after the operator had filled the form in.
     */
    it("should detach a level by re-pointing its fields and archiving it", async () => {
      mockDbClient.query.levels.findFirst = jest
        .fn()
        .mockResolvedValue(mockRow({ id: "level-1", name: "Level A", is_active: true }));

      const spy = jest.spyOn(service as any, "deleteImpact").mockResolvedValue({
        level: 1,
        field: 1,
        professor: 0,
        group: 0,
        student: 0,
        directChildren: [{ id: "field-1", name: "CS", type: "field" }],
      });

      const result = await service.detachAndDelete(
        "level",
        "level-1",
        { mode: "reassign_individual", assignments: [{ childId: "field-1", targetParentId: "level-2" }] },
        "user-1",
      );

      expect(result.affected.field).toBe(1);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "level.detach_delete", entityId: "level-1" }),
      );

      spy.mockRestore();
    });

    it("should reject a detach that leaves children without a target", async () => {
      mockDbClient.query.levels.findFirst = jest
        .fn()
        .mockResolvedValue(mockRow({ id: "level-1", name: "Level A", is_active: true }));

      const spy = jest.spyOn(service as any, "deleteImpact").mockResolvedValue({
        level: 1,
        field: 1,
        professor: 0,
        group: 0,
        student: 0,
        directChildren: [{ id: "field-1", name: "CS", type: "field" }],
      });

      await expect(
        service.detachAndDelete("level", "level-1", { mode: "reassign", targetParentId: undefined } as any, "user-1"),
      ).rejects.toThrow(BadRequestException);

      spy.mockRestore();
    });

    it("should still reject a detach of an already-archived level", async () => {
      mockDbClient.query.levels.findFirst = jest
        .fn()
        .mockResolvedValue(mockRow({ id: "level-1", is_active: false }));

      await expect(
        service.detachAndDelete("level", "level-1", { mode: "reassign", targetParentId: "level-2" }),
      ).rejects.toThrow(ConflictException);
    });

    it("should throw BadRequestException for incomplete reassignment plan", async () => {
      mockDbClient.query.professors.findFirst = jest.fn().mockResolvedValue(mockRow({ id: "prof-1", is_active: true }));

      await expect(
        service.detachAndDelete("professor", "prof-1", {
          mode: "reassign_individual",
          assignments: [{ childId: "group-2", targetParentId: "prof-2" }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reassign children and archive parent in a transaction", async () => {
      mockDbClient.query.professors.findFirst = jest.fn().mockResolvedValue(mockRow({ id: "prof-1", is_active: true, field_id: "field-1" }));

      const result = await service.detachAndDelete("professor", "prof-1", { mode: "reassign", targetParentId: "prof-2" }, "user-1");
      expect(result.affected.professor).toBe(1);
      expect(result.affected.group).toBe(1);
      expect(mockAudit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "professor.detach_delete", entityId: "prof-1" }),
      );
    });
  });
});
