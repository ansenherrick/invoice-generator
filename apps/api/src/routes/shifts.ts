import { Router, type Response } from "express";
import type { ShiftExportFormat, ShiftExportType, ShiftInvoiceOptions } from "@invoice/shared";
import { getUserId, requireAuth } from "../middleware/auth.js";
import { shiftService } from "../services/shiftService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const shiftsRouter = Router();

shiftsRouter.use(requireAuth);

shiftsRouter.get("/", asyncHandler(async (request, response) => {
  const shifts = await shiftService.list(getUserId(request));
  response.json({ shifts });
}));

shiftsRouter.post("/manual", asyncHandler(async (request, response) => {
  try {
    const shifts = await shiftService.createManualShift(getUserId(request), request.body);
    response.status(201).json({ shifts });
  } catch (error) {
    handleShiftError(response, error, "Unable to save manual shift.");
  }
}));

shiftsRouter.post("/clock-in", asyncHandler(async (request, response) => {
  try {
    const shifts = await shiftService.createClockIn(getUserId(request));
    response.status(201).json({ shifts });
  } catch (error) {
    handleShiftError(response, error, "Unable to clock in.");
  }
}));

shiftsRouter.post("/exports", asyncHandler(async (request, response) => {
  try {
    const result = await shiftService.exportShifts(
      getUserId(request),
      Array.isArray(request.body?.shiftIds) ? request.body.shiftIds.map(String) : [],
      request.body?.type === "re-export" ? ("re-export" as ShiftExportType) : ("initial-export" as ShiftExportType),
      request.body?.format === "invoice" ? ("invoice" as ShiftExportFormat) : ("csv" as ShiftExportFormat),
      (request.body?.invoice ?? {}) as ShiftInvoiceOptions,
    );
    response.json(result);
  } catch (error) {
    handleShiftError(response, error, "Unable to export shifts.");
  }
}));

shiftsRouter.post("/:shiftId/clock-out", asyncHandler(async (request, response) => {
  try {
    const shifts = await shiftService.clockOut(getUserId(request), String(request.params.shiftId), request.body?.notes);
    response.json({ shifts });
  } catch (error) {
    handleShiftError(response, error, "Unable to clock out.");
  }
}));

shiftsRouter.post("/:shiftId/breaks", asyncHandler(async (request, response) => {
  try {
    const shifts = await shiftService.startBreak(getUserId(request), String(request.params.shiftId), request.body?.type);
    response.status(201).json({ shifts });
  } catch (error) {
    handleShiftError(response, error, "Unable to start break.");
  }
}));

shiftsRouter.post("/:shiftId/breaks/:breakId/end", asyncHandler(async (request, response) => {
  try {
    const shifts = await shiftService.endBreak(
      getUserId(request),
      String(request.params.shiftId),
      String(request.params.breakId),
    );
    response.json({ shifts });
  } catch (error) {
    handleShiftError(response, error, "Unable to end break.");
  }
}));

shiftsRouter.patch("/:shiftId/notes", asyncHandler(async (request, response) => {
  try {
    const shifts = await shiftService.updateNotes(getUserId(request), String(request.params.shiftId), request.body?.notes);
    response.json({ shifts });
  } catch (error) {
    handleShiftError(response, error, "Unable to update shift notes.");
  }
}));

const handleShiftError = (response: Response, error: unknown, fallbackMessage: string) => {
  if (shiftService.isShiftServiceError(error)) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  response.status(400).json({
    error: error instanceof Error ? error.message : fallbackMessage,
  });
};
