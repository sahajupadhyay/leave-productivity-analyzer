/**
 * Core Business Logic & Calculation Engine
 * 
 * This module provides production-grade time calculation utilities, attendance processing,
 * and productivity analytics for the Leave & Productivity Analyzer system.
 * 
 * CRITICAL BUSINESS RULES:
 * - Monday-Friday: 8.5 hours expected
 * - Saturday: 4.0 hours expected
 * - Sunday: 0 hours (weekend)
 * - All dates normalized to midnight (00:00:00) to prevent time-based matching issues
 * 
 * DEPENDENCIES:
 * - date-fns: Used for all date manipulations to ensure timezone stability
 * 
 * SECURITY:
 * - All inputs validated with typed error handling
 * - No unsafe type coercion or silent failures
 * 
 * @module lib/calculations
 * @author Principal Software Engineer
 * @version 1.0.0
 */

import {
  getDaysInMonth,
  isSunday,
  isSaturday,
  startOfDay,
  format,
  setDate,
  startOfMonth,
} from 'date-fns';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Raw attendance input from Excel or external data source
 * Represents a single day's check-in/check-out record
 */
export interface RawAttendanceInput {
  /** MongoDB ObjectId of the employee */
  employeeId: string;
  
  /** Date of attendance (will be normalized to midnight) */
  date: Date;
  
  /** Check-in time in 24-hour format (HH:MM) */
  inTime: string;
  
  /** Check-out time in 24-hour format (HH:MM) */
  outTime: string;
}

/**
 * Processed attendance record ready for database insertion
 * Includes calculated fields and normalized status
 */
export interface ProcessedAttendanceRecord {
  /** MongoDB ObjectId of the employee */
  employeeId: string;
  
  /** Normalized date (midnight UTC) */
  date: Date;
  
  /** Check-in time string (HH:MM format) or null for absent/weekend */
  inTime: string | null;
  
  /** Check-out time string (HH:MM format) or null for absent/weekend */
  outTime: string | null;
  
  /** Calculated worked hours (decimal format) */
  workedHours: number;
  
  /** Attendance status */
  status: 'PRESENT' | 'ABSENT' | 'WEEKEND' | 'HOLIDAY';
}

/**
 * Productivity metrics for an employee or time period
 */
export interface ProductivityMetrics {
  /** Total hours actually worked */
  actualHours: number;
  
  /** Total hours expected based on business rules */
  expectedHours: number;
  
  /** Productivity percentage (0-100+) */
  productivityPercentage: number;
}

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Custom error for invalid time format inputs
 * Thrown when time strings don't match expected HH:MM 24-hour format
 */
export class InvalidTimeFormatError extends Error {
  /**
   * @param {string} timeString - The invalid time string that was provided
   * @param {string} [details] - Additional error context
   */
  constructor(
    public readonly timeString: string,
    public readonly details?: string
  ) {
    super(
      `Invalid time format: "${timeString}". Expected 24-hour format HH:MM (e.g., "09:30" or "14:45").${
        details ? ' ' + details : ''
      }`
    );
    this.name = 'InvalidTimeFormatError';
    
    // Maintains proper stack trace for V8 engines (Chrome, Node.js)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvalidTimeFormatError);
    }
  }
}

/**
 * Custom error for invalid date inputs
 * Thrown when date parameters are malformed or out of valid range
 */
export class InvalidDateError extends Error {
  /**
   * @param {string} message - Error description
   * @param {unknown} [value] - The invalid value that was provided
   */
  constructor(message: string, public readonly value?: unknown) {
    super(message);
    this.name = 'InvalidDateError';
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvalidDateError);
    }
  }
}

/**
 * Custom error for invalid calculation parameters
 * Thrown when calculation inputs fail validation
 */
export class CalculationError extends Error {
  /**
   * @param {string} message - Error description
   * @param {string} [context] - Additional context about the calculation
   */
  constructor(message: string, public readonly context?: string) {
    super(message);
    this.name = 'CalculationError';
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CalculationError);
    }
  }
}

// ============================================================================
// TIME PARSING UTILITIES
// ============================================================================

/**
 * 24-hour time format regex (HH:MM)
 * - Hours: 00-23
 * - Minutes: 00-59
 * - Format: Strict HH:MM with optional leading zeros
 */
const TIME_24HR_REGEX = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;

/**
 * Validates time string format
 * 
 * @param {string} timeStr - Time string to validate
 * @returns {boolean} True if valid 24-hour format
 * 
 * @example
 * isValidTimeFormat("09:30") // true
 * isValidTimeFormat("23:59") // true
 * isValidTimeFormat("24:00") // false
 * isValidTimeFormat("9:5")   // true (allows single digit)
 */
function isValidTimeFormat(timeStr: string): boolean {
  return TIME_24HR_REGEX.test(timeStr);
}

/**
 * Parse time string to decimal hours
 * 
 * Converts 24-hour format time string (HH:MM) to decimal representation.
 * Critical for accurate work hour calculations.
 * 
 * ALGORITHM:
 * 1. Validate format using strict regex
 * 2. Extract hours and minutes components
 * 3. Convert to decimal: hours + (minutes / 60)
 * 
 * EXAMPLES:
 * - "10:30" → 10.5
 * - "08:15" → 8.25
 * - "18:45" → 18.75
 * - "00:00" → 0.0
 * - "23:59" → 23.983333...
 * 
 * SECURITY:
 * - Strict format validation prevents injection
 * - No eval() or dynamic code execution
 * - Typed error for invalid inputs
 * 
 * @param {string} timeStr - Time in 24-hour format (HH:MM)
 * @returns {number} Decimal hours (e.g., 10.5 for 10:30)
 * @throws {InvalidTimeFormatError} If format is invalid
 * 
 * @example
 * parseTime("10:30") // Returns: 10.5
 * parseTime("08:00") // Returns: 8.0
 * parseTime("14:45") // Returns: 14.75
 * parseTime("invalid") // Throws: InvalidTimeFormatError
 */
export function parseTime(timeStr: string): number {
  // Input validation: check for null, undefined, or non-string
  if (typeof timeStr !== 'string' || timeStr.trim().length === 0) {
    throw new InvalidTimeFormatError(
      String(timeStr),
      'Time must be a non-empty string.'
    );
  }

  const trimmedTime = timeStr.trim();

  // Validate format using regex
  if (!isValidTimeFormat(trimmedTime)) {
    throw new InvalidTimeFormatError(
      trimmedTime,
      'Use 24-hour format: HH:MM (e.g., 09:30, 14:45).'
    );
  }

  // Extract components using regex match
  const match = trimmedTime.match(TIME_24HR_REGEX);
  if (!match) {
    // This should never happen due to validation above, but TypeScript safety
    throw new InvalidTimeFormatError(trimmedTime, 'Regex match failed unexpectedly.');
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  // Additional validation: ensure parsed values are in valid range
  if (hours < 0 || hours > 23) {
    throw new InvalidTimeFormatError(trimmedTime, 'Hours must be between 00 and 23.');
  }

  if (minutes < 0 || minutes > 59) {
    throw new InvalidTimeFormatError(trimmedTime, 'Minutes must be between 00 and 59.');
  }

  // Calculate decimal hours
  // CRITICAL: Use division by 60.0 to ensure float precision
  const decimalHours = hours + minutes / 60.0;

  return decimalHours;
}

/**
 * Calculate worked hours between two time strings
 * 
 * Handles overnight shifts and validates that outTime > inTime.
 * Uses parseTime() for conversion with full error handling.
 * 
 * BUSINESS LOGIC:
 * - If outTime < inTime, assumes overnight shift (adds 24 hours)
 * - Validates both time formats before calculation
 * - Returns precise decimal hours
 * 
 * @param {string} inTime - Check-in time (HH:MM)
 * @param {string} outTime - Check-out time (HH:MM)
 * @returns {number} Worked hours (decimal)
 * @throws {InvalidTimeFormatError} If either time is invalid
 * @throws {CalculationError} If calculation produces invalid result
 * 
 * @example
 * calculateWorkedHours("09:00", "17:30") // Returns: 8.5
 * calculateWorkedHours("23:00", "01:00") // Returns: 2.0 (overnight)
 * calculateWorkedHours("08:15", "16:45") // Returns: 8.5
 */
export function calculateWorkedHours(inTime: string, outTime: string): number {
  // Parse both times (will throw InvalidTimeFormatError if invalid)
  const inHours = parseTime(inTime);
  const outHours = parseTime(outTime);

  // Calculate duration
  let workedHours: number;

  if (outHours >= inHours) {
    // Normal same-day shift
    workedHours = outHours - inHours;
  } else {
    // Overnight shift: add 24 hours to outTime
    workedHours = 24 - inHours + outHours;
  }

  // Validation: worked hours must be positive and reasonable (< 24h)
  if (workedHours < 0 || workedHours > 24) {
    throw new CalculationError(
      `Calculated worked hours (${workedHours}) is outside valid range [0, 24].`,
      `inTime: ${inTime}, outTime: ${outTime}`
    );
  }

  // Round to 2 decimal places to avoid floating point precision issues
  return Math.round(workedHours * 100) / 100;
}

// ============================================================================
// BUSINESS RULES: EXPECTED HOURS CALCULATION
// ============================================================================

/**
 * Expected work hours per day based on business rules
 */
const EXPECTED_HOURS = {
  /** Monday through Friday */
  WEEKDAY: 8.5,
  
  /** Saturday */
  SATURDAY: 4.0,
  
  /** Sunday (weekend) */
  SUNDAY: 0.0,
} as const;

/**
 * Get expected work hours for a given date
 * 
 * Applies business rules to determine expected hours based on day of week.
 * Uses date-fns for reliable day-of-week detection.
 * 
 * BUSINESS RULES:
 * - Sunday: 0 hours (weekend)
 * - Saturday: 4 hours (half day)
 * - Monday-Friday: 8.5 hours (full day)
 * 
 * IMPORTANT: Input date should be normalized to midnight for consistency.
 * This function does NOT modify the input date.
 * 
 * @param {Date} date - Date to check (should be normalized to midnight)
 * @returns {number} Expected hours for that date
 * @throws {InvalidDateError} If date is invalid
 * 
 * @example
 * // Monday, Jan 1, 2024
 * getExpectedHours(new Date(2024, 0, 1)) // Returns: 8.5
 * 
 * // Saturday, Jan 6, 2024
 * getExpectedHours(new Date(2024, 0, 6)) // Returns: 4.0
 * 
 * // Sunday, Jan 7, 2024
 * getExpectedHours(new Date(2024, 0, 7)) // Returns: 0.0
 */
export function getExpectedHours(date: Date): number {
  // Validate input is a valid Date object
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new InvalidDateError('Invalid date provided to getExpectedHours', date);
  }

  // Use date-fns for reliable day-of-week detection
  if (isSunday(date)) {
    return EXPECTED_HOURS.SUNDAY;
  }

  if (isSaturday(date)) {
    return EXPECTED_HOURS.SATURDAY;
  }

  // Monday through Friday
  return EXPECTED_HOURS.WEEKDAY;
}

// ============================================================================
// CORE LOGIC: ATTENDANCE PROCESSING
// ============================================================================

/**
 * Normalize date to midnight (00:00:00.000)
 * 
 * CRITICAL: This prevents date matching issues where times interfere.
 * Example: "2024-01-01T10:00" will NOT match "2024-01-01T00:00" without normalization.
 * 
 * Uses date-fns startOfDay for timezone-safe normalization.
 * 
 * @param {Date} date - Date to normalize
 * @returns {Date} New date object set to midnight
 * 
 * @example
 * normalizeDate(new Date("2024-01-01T14:30:00"))
 * // Returns: Date object for 2024-01-01T00:00:00.000
 */
function normalizeDate(date: Date): Date {
  return startOfDay(date);
}

/**
 * Generate array of all dates in a given month
 * 
 * Creates a complete date range from day 1 to the last day of the month.
 * All dates are normalized to midnight for consistent matching.
 * 
 * ALGORITHM:
 * 1. Determine number of days in the month (handles leap years)
 * 2. Create array of sequential dates
 * 3. Normalize each date to midnight
 * 
 * @param {number} year - Full year (e.g., 2024)
 * @param {number} month - Month (1-12, NOT 0-11)
 * @returns {Date[]} Array of normalized dates for entire month
 * @throws {InvalidDateError} If year/month parameters are invalid
 * 
 * @example
 * generateMonthDates(2024, 1)  // Returns: [Jan 1, Jan 2, ..., Jan 31]
 * generateMonthDates(2024, 2)  // Returns: [Feb 1, Feb 2, ..., Feb 29] (leap year)
 */
function generateMonthDates(year: number, month: number): Date[] {
  // Validate year
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new InvalidDateError(
      `Invalid year: ${year}. Must be an integer between 1900 and 2100.`,
      year
    );
  }

  // Validate month (1-12)
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new InvalidDateError(
      `Invalid month: ${month}. Must be an integer between 1 and 12.`,
      month
    );
  }

  // Create first day of month (date-fns uses 0-based months internally)
  const firstDay = startOfMonth(new Date(year, month - 1, 1));

  // Get number of days in this month (handles leap years automatically)
  const daysInMonth = getDaysInMonth(firstDay);

  // Generate array of all dates
  const dates: Date[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = setDate(firstDay, day);
    dates.push(normalizeDate(date));
  }

  return dates;
}

/**
 * Find raw attendance record for a specific date
 * 
 * Searches rawRecords array for a matching date (normalized comparison).
 * Returns the first match found, or undefined if no match.
 * 
 * PERFORMANCE: O(n) linear search. For large datasets, consider indexing.
 * 
 * @param {Date} targetDate - Normalized date to find
 * @param {RawAttendanceInput[]} rawRecords - Array of raw attendance records
 * @returns {RawAttendanceInput | undefined} Matching record or undefined
 */
function findRecordForDate(
  targetDate: Date,
  rawRecords: RawAttendanceInput[]
): RawAttendanceInput | undefined {
  const targetTime = targetDate.getTime();
  
  return rawRecords.find((record) => {
    const normalizedRecordDate = normalizeDate(record.date);
    return normalizedRecordDate.getTime() === targetTime;
  });
}

/**
 * Process monthly attendance records with gap filling
 * 
 * This is the CORE BUSINESS LOGIC function that transforms incomplete raw data
 * into a complete attendance record for an entire month.
 * 
 * CRITICAL FEATURES:
 * 1. **Gap Filling**: Excel data only contains present days. This function fills
 *    in ALL missing days as ABSENT or WEEKEND.
 * 2. **Date Normalization**: All dates normalized to midnight to prevent
 *    time-based matching issues.
 * 3. **Business Rule Application**: Automatically determines status based on
 *    day of week and data availability.
 * 4. **Batch Insert Ready**: Returns array formatted for Prisma createMany()
 * 
 * ALGORITHM:
 * 1. Generate complete array of dates for the month
 * 2. For each date:
 *    a. Check if raw record exists
 *    b. If YES: Calculate worked hours, mark PRESENT
 *    c. If NO: Check day of week
 *       - Sunday: Mark WEEKEND
 *       - Monday-Saturday: Mark ABSENT (this identifies leaves!)
 * 3. Return complete processed array
 * 
 * BUSINESS RULES APPLIED:
 * - Present days: Calculate actual worked hours from in/out times
 * - Absent days: 0 worked hours, ABSENT status
 * - Sundays: 0 worked hours, WEEKEND status
 * - Saturdays without records: 0 worked hours, ABSENT status (treated as leave)
 * 
 * INPUT VALIDATION:
 * - All raw records must have valid employeeId
 * - All times must be in correct format (validated by parseTime)
 * - Duplicate dates for same employee should be handled by caller
 * 
 * @param {number} year - Full year (e.g., 2024)
 * @param {number} month - Month number (1-12, NOT 0-11)
 * @param {RawAttendanceInput[]} rawRecords - Raw attendance data (only present days)
 * @returns {ProcessedAttendanceRecord[]} Complete month of attendance records
 * @throws {InvalidDateError} If year/month are invalid
 * @throws {InvalidTimeFormatError} If time strings are malformed
 * @throws {CalculationError} If worked hours calculation fails
 * 
 * @example
 * const rawData: RawAttendanceInput[] = [
 *   {
 *     employeeId: "507f1f77bcf86cd799439011",
 *     date: new Date(2024, 0, 2), // Jan 2 (Present)
 *     inTime: "09:00",
 *     outTime: "17:30"
 *   }
 *   // Note: Jan 1 is MISSING (will be marked ABSENT or WEEKEND)
 * ];
 * 
 * const processed = processMonthlyAttendance(2024, 1, rawData);
 * // Returns complete array for all 31 days of January
 * // Jan 1 (Monday): ABSENT, 0 hours
 * // Jan 2 (Present): PRESENT, 8.5 hours
 * // Jan 7 (Sunday): WEEKEND, 0 hours
 * // etc.
 */
export function processMonthlyAttendance(
  year: number,
  month: number,
  rawRecords: RawAttendanceInput[]
): ProcessedAttendanceRecord[] {
  // Validate inputs
  if (!Array.isArray(rawRecords)) {
    throw new CalculationError('rawRecords must be an array', 'processMonthlyAttendance');
  }

  // Normalize all raw record dates to midnight
  const normalizedRawRecords: RawAttendanceInput[] = rawRecords.map((record) => ({
    ...record,
    date: normalizeDate(record.date),
  }));

  // Generate complete array of dates for the month
  const allDatesInMonth = generateMonthDates(year, month);

  // Process each date
  const processedRecords: ProcessedAttendanceRecord[] = allDatesInMonth.map((date) => {
    // Check if we have a raw record for this date
    const rawRecord = findRecordForDate(date, normalizedRawRecords);

    if (rawRecord) {
      // CASE 1: Employee was present on this day
      try {
        const workedHours = calculateWorkedHours(rawRecord.inTime, rawRecord.outTime);

        return {
          employeeId: rawRecord.employeeId,
          date: date,
          inTime: rawRecord.inTime,
          outTime: rawRecord.outTime,
          workedHours: workedHours,
          status: 'PRESENT' as const,
        };
      } catch (error) {
        // If time calculation fails, log error and mark as invalid/absent
        console.error(
          `[processMonthlyAttendance] Error calculating hours for ${format(date, 'yyyy-MM-dd')}:`,
          error
        );

        // Rethrow to maintain strict error handling (no silent failures)
        throw error;
      }
    } else {
      // CASE 2: No raw record exists - determine status based on day of week
      if (isSunday(date)) {
        // Sunday: Always weekend
        return {
          employeeId: normalizedRawRecords[0]?.employeeId || '', // Use first record's employeeId
          date: date,
          inTime: null,
          outTime: null,
          workedHours: 0,
          status: 'WEEKEND' as const,
        };
      } else {
        // Monday-Saturday without record: Mark as ABSENT (leave/absence)
        return {
          employeeId: normalizedRawRecords[0]?.employeeId || '',
          date: date,
          inTime: null,
          outTime: null,
          workedHours: 0,
          status: 'ABSENT' as const,
        };
      }
    }
  });

  return processedRecords;
}

// ============================================================================
// PRODUCTIVITY CALCULATIONS
// ============================================================================

/**
 * Calculate productivity percentage
 * 
 * Computes productivity as (Actual Hours / Expected Hours) × 100.
 * Handles edge cases like zero expected hours gracefully.
 * 
 * BUSINESS LOGIC:
 * - If expectedHours is 0 (e.g., Sunday), return 100% (N/A scenario)
 * - If actualHours exceeds expected (overtime), percentage > 100%
 * - Result rounded to 1 decimal place for readability
 * 
 * EDGE CASES:
 * - expectedHours = 0: Returns 100 (avoids division by zero)
 * - actualHours < 0: Throws CalculationError (invalid input)
 * - expectedHours < 0: Throws CalculationError (invalid input)
 * 
 * @param {number} actualHours - Actual hours worked (must be >= 0)
 * @param {number} expectedHours - Expected hours (must be >= 0)
 * @returns {number} Productivity percentage rounded to 1 decimal place
 * @throws {CalculationError} If inputs are negative
 * 
 * @example
 * calculateProductivity(8.5, 8.5)  // Returns: 100.0 (met expectations)
 * calculateProductivity(7.0, 8.5)  // Returns: 82.4 (underperformed)
 * calculateProductivity(9.5, 8.5)  // Returns: 111.8 (overtime)
 * calculateProductivity(0, 0)      // Returns: 100.0 (N/A day - Sunday)
 * calculateProductivity(4.0, 0)    // Returns: 100.0 (worked on day off)
 */
export function calculateProductivity(
  actualHours: number,
  expectedHours: number
): number {
  // Validate inputs
  if (typeof actualHours !== 'number' || actualHours < 0) {
    throw new CalculationError(
      `Invalid actualHours: ${actualHours}. Must be a non-negative number.`,
      'calculateProductivity'
    );
  }

  if (typeof expectedHours !== 'number' || expectedHours < 0) {
    throw new CalculationError(
      `Invalid expectedHours: ${expectedHours}. Must be a non-negative number.`,
      'calculateProductivity'
    );
  }

  // Edge case: If expected hours is 0 (e.g., Sunday or holiday)
  // Return 100% to indicate "not applicable" rather than error
  if (expectedHours === 0) {
    return 100.0;
  }

  // Calculate productivity percentage
  const productivity = (actualHours / expectedHours) * 100;

  // Round to 1 decimal place
  return Math.round(productivity * 10) / 10;
}

/**
 * Calculate aggregate productivity metrics for a time period
 * 
 * Aggregates multiple attendance records to compute overall productivity.
 * Useful for monthly/quarterly reports.
 * 
 * @param {ProcessedAttendanceRecord[]} records - Array of processed attendance records
 * @returns {ProductivityMetrics} Aggregated productivity metrics
 * @throws {CalculationError} If records array is invalid
 * 
 * @example
 * const records = processMonthlyAttendance(2024, 1, rawData);
 * const metrics = calculateAggregateProductivity(records);
 * console.log(`Productivity: ${metrics.productivityPercentage}%`);
 */
export function calculateAggregateProductivity(
  records: ProcessedAttendanceRecord[]
): ProductivityMetrics {
  if (!Array.isArray(records) || records.length === 0) {
    throw new CalculationError(
      'Records array must be non-empty',
      'calculateAggregateProductivity'
    );
  }

  let totalActualHours = 0;
  let totalExpectedHours = 0;

  for (const record of records) {
    totalActualHours += record.workedHours;
    totalExpectedHours += getExpectedHours(record.date);
  }

  const productivityPercentage = calculateProductivity(
    totalActualHours,
    totalExpectedHours
  );

  return {
    actualHours: Math.round(totalActualHours * 100) / 100,
    expectedHours: Math.round(totalExpectedHours * 100) / 100,
    productivityPercentage,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Exported utilities and constants for external use
 */
export const CONSTANTS = {
  EXPECTED_HOURS,
  TIME_24HR_REGEX,
} as const;
