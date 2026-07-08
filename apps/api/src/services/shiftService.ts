import {
  buildShiftCsv,
  buildShiftExportFileName,
  buildShiftInvoiceText,
  type ShiftBreak,
  type ShiftExportFormat,
  type ShiftExportType,
  type ShiftInvoiceOptions,
} from "@invoice/shared";
import { env } from "../config/env.js";
import { shiftRepository } from "../repositories/shiftRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { devDataStore } from "./devDataStore.js";
import { profileService } from "./profileService.js";

class ShiftServiceError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const normalizeIsoDateTime = (value: string) => {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

const getAccountIdentity = async (userId: string) => {
  const [profile, user] = await Promise.all([
    profileService.get(userId),
    env.useDevData ? devDataStore.findUserById(userId) : userRepository.findById(userId),
  ]);

  return {
    label: profile.displayName || profile.businessName || user?.email || "Freelancer",
    email: profile.email || user?.email || "",
  };
};

const listShifts = async (userId: string) =>
  env.useDevData ? devDataStore.listShifts(userId) : shiftRepository.listByUserId(userId);

const findShift = async (userId: string, shiftId: string) =>
  env.useDevData ? devDataStore.findShiftById(shiftId, userId) : shiftRepository.findById(userId, shiftId);

const findActiveShift = async (userId: string) =>
  env.useDevData ? devDataStore.findActiveShift(userId) : shiftRepository.findActiveByUserId(userId);

export const shiftService = {
  async list(userId: string) {
    return listShifts(userId);
  },

  async createClockIn(userId: string) {
    const activeShift = await findActiveShift(userId);
    if (activeShift) {
      throw new ShiftServiceError(409, "You already have an active shift running.");
    }

    if (env.useDevData) {
      await devDataStore.createClockInShift(userId);
    } else {
      await shiftRepository.createClockInShift(userId);
    }

    return listShifts(userId);
  },

  async createManualShift(userId: string, input: { startAt?: string; endAt?: string; breakMinutes?: number; notes?: string }) {
    const startAt = normalizeIsoDateTime(input.startAt ?? "");
    const endAt = normalizeIsoDateTime(input.endAt ?? "");
    const breakMinutes = Math.max(0, Number.parseInt(String(input.breakMinutes ?? 0), 10) || 0);
    const notes = String(input.notes ?? "").trim();

    if (!startAt || !endAt) {
      throw new ShiftServiceError(400, "Choose both a start and end time for the manual shift.");
    }

    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      throw new ShiftServiceError(400, "The shift end time must be later than the start time.");
    }

    const totalMinutes = Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000);
    if (breakMinutes >= totalMinutes) {
      throw new ShiftServiceError(400, "Break minutes must be less than the total shift length.");
    }

    if (env.useDevData) {
      await devDataStore.createManualShift(userId, { startAt, endAt, breakMinutes, notes });
    } else {
      await shiftRepository.createManualShift(userId, { startAt, endAt, breakMinutes, notes });
    }

    return listShifts(userId);
  },

  async clockOut(userId: string, shiftId: string, notes?: string) {
    const shift = await findShift(userId, shiftId);
    if (!shift || shift.clockOutAt) {
      throw new ShiftServiceError(404, "There is no active shift to clock out from.");
    }

    if (env.useDevData) {
      await devDataStore.updateShift(shiftId, userId, (current) => ({
        ...current,
        clockOutAt: new Date().toISOString(),
        notes: String(notes ?? "").trim(),
        breaks: current.breaks.map((entry: ShiftBreak) => (entry.endAt ? entry : { ...entry, endAt: new Date().toISOString() })),
      }));
    } else {
      await shiftRepository.clockOutShift(userId, shiftId, String(notes ?? "").trim());
    }

    return listShifts(userId);
  },

  async startBreak(userId: string, shiftId: string, type?: string) {
    const shift = await findShift(userId, shiftId);
    if (!shift || shift.clockOutAt) {
      throw new ShiftServiceError(404, "Clock in before starting a break.");
    }

    const openBreak = shift.breaks.find((entry: ShiftBreak) => !entry.endAt);
    if (openBreak) {
      throw new ShiftServiceError(409, "Finish the current break before starting another one.");
    }

    const nextType = String(type ?? "").trim() || "Break";
    if (env.useDevData) {
      await devDataStore.updateShift(shiftId, userId, (current) => ({
        ...current,
        breaks: [
          ...current.breaks,
          {
            id: crypto.randomUUID(),
            type: nextType,
            startAt: new Date().toISOString(),
            endAt: null,
          },
        ],
      }));
    } else {
      await shiftRepository.startBreak(shiftId, nextType);
    }

    return listShifts(userId);
  },

  async endBreak(userId: string, shiftId: string, breakId: string) {
    const shift = await findShift(userId, shiftId);
    if (!shift) {
      throw new ShiftServiceError(404, "There is no active break to end.");
    }

    const targetBreak = shift.breaks.find((entry: ShiftBreak) => entry.id === breakId && !entry.endAt);
    if (!targetBreak) {
      throw new ShiftServiceError(404, "There is no active break to end.");
    }

    if (env.useDevData) {
      await devDataStore.updateShift(shiftId, userId, (current) => ({
        ...current,
        breaks: current.breaks.map((entry: ShiftBreak) =>
          entry.id === breakId ? { ...entry, endAt: new Date().toISOString() } : entry,
        ),
      }));
    } else {
      await shiftRepository.endBreak(shiftId, breakId);
    }

    return listShifts(userId);
  },

  async updateNotes(userId: string, shiftId: string, notes?: string) {
    const shift = await findShift(userId, shiftId);
    if (!shift) {
      throw new ShiftServiceError(404, "Shift not found.");
    }

    if (env.useDevData) {
      await devDataStore.updateShift(shiftId, userId, (current) => ({
        ...current,
        notes: String(notes ?? "").trim(),
      }));
    } else {
      await shiftRepository.updateNotes(userId, shiftId, String(notes ?? "").trim());
    }

    return listShifts(userId);
  },

  async exportShifts(
    userId: string,
    shiftIds: string[],
    exportType: ShiftExportType,
    format: ShiftExportFormat,
    invoiceOptions: ShiftInvoiceOptions = {},
  ) {
    if (!shiftIds.length) {
      throw new ShiftServiceError(400, "Select at least one completed shift before exporting.");
    }

    const shifts = env.useDevData
      ? (await devDataStore.listShifts(userId)).filter((shift) => shiftIds.includes(shift.id) && shift.clockOutAt)
      : await shiftRepository.findCompletedByIds(userId, shiftIds);

    if (!shifts.length) {
      throw new ShiftServiceError(400, "No completed shifts were available to export.");
    }

    const identity = await getAccountIdentity(userId);
    const exportedAt = new Date().toISOString();
    const batchId = crypto.randomUUID();
    const filename = buildShiftExportFileName(identity.label, exportType, exportedAt, format);
    const content =
      format === "invoice"
        ? buildShiftInvoiceText(shifts, identity.label, exportedAt, invoiceOptions)
        : buildShiftCsv(shifts, identity.label, identity.email, exportedAt, exportType);

    if (env.useDevData) {
      await devDataStore.recordShiftExport(shiftIds, userId, {
        batchId,
        exportedAt,
        type: exportType,
        format,
      });
    } else {
      await shiftRepository.recordExports(shiftIds, {
        batchId,
        exportedAt,
        type: exportType,
        format,
      });
    }

    return {
      content,
      filename,
      mimeType: format === "invoice" ? "text/plain;charset=utf-8" : "text/csv;charset=utf-8",
      format,
      exportedCount: shifts.length,
      shifts: await listShifts(userId),
    };
  },

  isShiftServiceError(error: unknown): error is ShiftServiceError {
    return error instanceof ShiftServiceError;
  },
};
