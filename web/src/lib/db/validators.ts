//+_+// Domain validation utilities for dates, quantities, timezones, and enums
import { ValidationError } from "./errors";
import type { GroupType } from "./types";

//+_+// Validates that dateStr is a real calendar date in YYYY-MM-DD format (accounting for leap years and month ends)
export function validateLocalDate(dateStr: string, fieldName = "날짜"): void {
  if (!dateStr || typeof dateStr !== "string") {
    throw new ValidationError(`${fieldName}를 입력해 주세요.`);
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    throw new ValidationError(
      `${fieldName}는 YYYY-MM-DD 형식이어야 합니다. 입력값: ${dateStr}`
    );
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) {
    throw new ValidationError(
      `${fieldName}의 월(1~12)이 올바르지 않습니다: ${dateStr}`
    );
  }

  //+_+// Create UTC date and check whether year, month, day match exactly
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    throw new ValidationError(
      `${fieldName}에 실제 달력에 존재하지 않는 날짜가 입력되었습니다: ${dateStr}`
    );
  }
}

//+_+// Validates start and end dates ensuring end >= start
export function validateDateRange(
  startDate: string,
  endDate: string | null | undefined,
  rangeName = "기간"
): void {
  validateLocalDate(startDate, `${rangeName} 시작일`);
  if (endDate) {
    validateLocalDate(endDate, `${rangeName} 종료일`);
    if (endDate < startDate) {
      throw new ValidationError(
        `${rangeName} 종료일(${endDate})은 시작일(${startDate})보다 앞설 수 없습니다.`
      );
    }
  }
}

//+_+// Validates quantity according to groupType
export function validateQuantity(
  quantity: number,
  groupType: GroupType,
  fieldName = "수량"
): void {
  if (
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    Number.isNaN(quantity)
  ) {
    throw new ValidationError(`${fieldName}은 유효한 유한한 숫자여야 합니다.`);
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError(`${fieldName}은 1 이상의 정수여야 합니다.`);
  }

  if (groupType === "INDIVIDUAL" && quantity !== 1) {
    throw new ValidationError("개체 식물의 수량은 반드시 1이어야 합니다.");
  }

  if (groupType === "GROUP" && quantity < 1) {
    throw new ValidationError("그룹 식물의 수량은 1 이상이어야 합니다.");
  }
}

//+_+// Validates that timeZone is a recognized IANA timezone
export function validateTimeZone(timeZone: string): void {
  if (!timeZone || typeof timeZone !== "string" || !timeZone.trim()) {
    throw new ValidationError("시간대를 입력해 주세요.");
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: timeZone.trim() });
  } catch {
    throw new ValidationError(
      `유효하지 않은 IANA 시간대입니다: ${timeZone}`
    );
  }
}

//+_+// Helper to get local date string YYYY-MM-DD from user's local timezone
export function getLocalDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
