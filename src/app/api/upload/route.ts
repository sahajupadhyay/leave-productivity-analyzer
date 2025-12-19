/**
 * Excel File Upload & Attendance Processing API Route
 * 
 * POST /api/upload
 * 
 * This endpoint handles Excel file uploads containing employee attendance data,
 * processes the records using the calculation engine, and persists them to MongoDB.
 * 
 * CRITICAL FEATURES:
 * - Excel parsing with date serial number handling
 * - Gap filling for missing attendance days
 * - Idempotent operations (delete-then-insert for re-uploads)
 * - Batch processing for optimal database performance
 * - Comprehensive error handling with appropriate HTTP status codes
 * 
 * EXPECTED EXCEL FORMAT:
 * | Employee Name | Date       | In Time | Out Time |
 * |--------------|------------|---------|----------|
 * | John Doe     | 01/01/2024 | 09:00   | 17:30    |
 * | Jane Smith   | 01/01/2024 | 08:30   | 16:45    |
 * 
 * SECURITY:
 * - File type validation (only .xlsx, .xls)
 * - File size limits enforced by Next.js (default 4.5MB body limit)
 * - Input sanitization before database operations
 * - No arbitrary code execution from Excel content
 * 
 * PERFORMANCE:
 * - Batch operations using createMany (single transaction)
 * - Efficient employee lookup/upsert strategy
 * - Transaction-wrapped operations for data consistency
 * 
 * @module app/api/upload/route
 * @author Principal Software Engineer
 * @version 1.0.0
 */

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { prisma } from '@/lib/prisma';
import {
  processMonthlyAttendance,
  type RawAttendanceInput,
  InvalidTimeFormatError,
  InvalidDateError,
  CalculationError,
} from '@/lib/calculations';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Excel row structure as parsed from the spreadsheet
 * 
 * NOTE: Excel column headers are case-sensitive and must match exactly.
 * Adjust these property names to match your actual Excel file headers.
 */
interface ExcelRow {
  /** Employee full name (must match across rows for grouping) */
  'Employee Name': string;
  
  /** Date in various formats (Excel serial number, string date, etc.) */
  'Date': number | string | Date;
  
  /** Check-in time (24-hour format HH:MM or variations) */
  'In Time': string | number;
  
  /** Check-out time (24-hour format HH:MM or variations) */
  'Out Time': string | number;
}

/**
 * Validated and normalized attendance record ready for processing
 */
interface NormalizedAttendanceRecord {
  employeeName: string;
  date: Date;
  inTime: string;
  outTime: string;
}

/**
 * API response structure for successful uploads
 */
interface UploadSuccessResponse {
  success: true;
  count: number;
  message: string;
  details: {
    employeeCount: number;
    recordCount: number;
    month: number;
    year: number;
  };
}

/**
 * API response structure for errors
 */
interface UploadErrorResponse {
  success: false;
  error: string;
  details?: string;
}

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/**
 * Error thrown when file validation fails
 */
class FileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileValidationError';
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FileValidationError);
    }
  }
}

/**
 * Error thrown when Excel parsing fails
 */
class ExcelParsingError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ExcelParsingError';
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ExcelParsingError);
    }
  }
}

/**
 * Error thrown when data validation fails
 */
class DataValidationError extends Error {
  constructor(message: string, public readonly rowIndex?: number) {
    super(message);
    this.name = 'DataValidationError';
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DataValidationError);
    }
  }
}

// ============================================================================
// EXCEL PARSING UTILITIES
// ============================================================================

/**
 * Validate file extension
 * 
 * Ensures only Excel files are processed for security and compatibility.
 * 
 * @param {string} filename - Original filename from upload
 * @returns {boolean} True if valid Excel file
 * @throws {FileValidationError} If extension is invalid
 */
function validateFileExtension(filename: string): boolean {
  const validExtensions = ['.xlsx', '.xls'];
  const lowerFilename = filename.toLowerCase();
  
  const isValid = validExtensions.some((ext) => lowerFilename.endsWith(ext));
  
  if (!isValid) {
    throw new FileValidationError(
      `Invalid file type. Expected Excel file (.xlsx or .xls), got: ${filename}`
    );
  }
  
  return true;
}

/**
 * Convert Excel serial date number to JavaScript Date
 * 
 * CRITICAL: Excel stores dates as serial numbers (days since 1900-01-01).
 * Example: 45321 = 2024-01-15
 * 
 * This function handles:
 * - Excel serial numbers (e.g., 44562)
 * - String dates (e.g., "01/15/2024", "2024-01-15")
 * - JavaScript Date objects (pass-through)
 * 
 * ALGORITHM:
 * 1. Check if input is already a Date object
 * 2. If number, convert using Excel epoch (Dec 30, 1899)
 * 3. If string, attempt to parse as ISO or locale date
 * 4. Validate result is a valid date
 * 
 * EXCEL DATE QUIRKS:
 * - Excel incorrectly treats 1900 as a leap year (legacy Lotus 1-2-3 bug)
 * - Serial number 1 = January 1, 1900
 * - We use Dec 30, 1899 as epoch to account for this
 * 
 * @param {number | string | Date} excelDate - Date value from Excel
 * @returns {Date} JavaScript Date object (normalized to midnight)
 * @throws {DataValidationError} If date cannot be parsed
 * 
 * @example
 * parseExcelDate(45321) // Returns: Date object for 2024-01-15
 * parseExcelDate("01/15/2024") // Returns: Date object for 2024-01-15
 * parseExcelDate(new Date(2024, 0, 15)) // Returns: Same date (pass-through)
 */
function parseExcelDate(excelDate: number | string | Date): Date {
  // Case 1: Already a Date object
  if (excelDate instanceof Date) {
    if (isNaN(excelDate.getTime())) {
      throw new DataValidationError('Invalid Date object provided');
    }
    return excelDate;
  }
  
  // Case 2: Excel serial number (numeric)
  if (typeof excelDate === 'number') {
    // Excel epoch: December 30, 1899
    // Add the serial number as days
    const excelEpoch = new Date(1899, 11, 30);
    const milliseconds = excelDate * 24 * 60 * 60 * 1000;
    const date = new Date(excelEpoch.getTime() + milliseconds);
    
    if (isNaN(date.getTime())) {
      throw new DataValidationError(
        `Invalid Excel serial date number: ${excelDate}`
      );
    }
    
    return date;
  }
  
  // Case 3: String date (various formats)
  if (typeof excelDate === 'string') {
    // Try parsing as ISO date first (2024-01-15)
    let date = new Date(excelDate);
    
    // If ISO parsing failed, try locale-specific formats
    if (isNaN(date.getTime())) {
      // Try parsing MM/DD/YYYY or DD/MM/YYYY
      const parts = excelDate.split(/[-/]/);
      if (parts.length === 3) {
        // Assume MM/DD/YYYY format (US standard)
        const month = parseInt(parts[0], 10) - 1; // Months are 0-indexed
        const day = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        
        date = new Date(year, month, day);
      }
    }
    
    if (isNaN(date.getTime())) {
      throw new DataValidationError(
        `Unable to parse date string: "${excelDate}". Expected formats: YYYY-MM-DD, MM/DD/YYYY, or Excel serial number.`
      );
    }
    
    return date;
  }
  
  throw new DataValidationError(
    `Invalid date type: ${typeof excelDate}. Expected number, string, or Date object.`
  );
}

/**
 * Normalize time string to 24-hour HH:MM format
 * 
 * Handles various time formats from Excel:
 * - "09:30" (already correct)
 * - "9:30" (single digit hour)
 * - Numeric values (Excel time serial)
 * - "9:30 AM" / "5:30 PM" (12-hour format)
 * 
 * @param {string | number} timeValue - Time value from Excel
 * @returns {string} Normalized 24-hour format HH:MM
 * @throws {DataValidationError} If time cannot be parsed
 */
function normalizeTimeString(timeValue: string | number): string {
  // Case 1: Already a string
  if (typeof timeValue === 'string') {
    const trimmed = timeValue.trim();
    
    // Handle 12-hour format with AM/PM
    const amPmMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (amPmMatch) {
      let hours = parseInt(amPmMatch[1], 10);
      const minutes = amPmMatch[2];
      const period = amPmMatch[3].toUpperCase();
      
      // Convert to 24-hour format
      if (period === 'PM' && hours !== 12) {
        hours += 12;
      } else if (period === 'AM' && hours === 12) {
        hours = 0;
      }
      
      return `${hours.toString().padStart(2, '0')}:${minutes}`;
    }
    
    // Handle 24-hour format (possibly single-digit hour)
    const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2];
      
      // Validate range
      if (hours < 0 || hours > 23 || parseInt(minutes, 10) < 0 || parseInt(minutes, 10) > 59) {
        throw new DataValidationError(
          `Time out of range: ${trimmed}. Hours must be 0-23, minutes 0-59.`
        );
      }
      
      return `${hours.toString().padStart(2, '0')}:${minutes}`;
    }
    
    throw new DataValidationError(
      `Invalid time format: "${trimmed}". Expected HH:MM or HH:MM AM/PM.`
    );
  }
  
  // Case 2: Numeric (Excel time serial: fraction of a day)
  if (typeof timeValue === 'number') {
    // Excel time: 0.5 = 12:00, 0.375 = 09:00
    const totalMinutes = Math.round(timeValue * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  
  throw new DataValidationError(
    `Invalid time type: ${typeof timeValue}. Expected string or number.`
  );
}

/**
 * Parse Excel file buffer and extract attendance data
 * 
 * This is the core Excel parsing function that:
 * 1. Reads the Excel file buffer
 * 2. Extracts the first worksheet
 * 3. Converts to JSON with header row recognition
 * 4. Validates and normalizes each row
 * 
 * PERFORMANCE: O(n) where n = number of rows
 * MEMORY: Loads entire sheet into memory (suitable for typical attendance files)
 * 
 * @param {Buffer} buffer - Excel file buffer
 * @returns {NormalizedAttendanceRecord[]} Array of normalized attendance records
 * @throws {ExcelParsingError} If file cannot be read
 * @throws {DataValidationError} If data is malformed
 */
function parseExcelFile(buffer: Buffer): NormalizedAttendanceRecord[] {
  try {
    // Read Excel file from buffer
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: false, // We'll handle date conversion manually for better control
    });
    
    // Validate workbook has sheets
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new ExcelParsingError('Excel file contains no worksheets');
    }
    
    // Extract first sheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert sheet to JSON (header row = column names)
    const rawData: ExcelRow[] = XLSX.utils.sheet_to_json(worksheet, {
      header: undefined, // Use first row as headers
      defval: '', // Default value for empty cells
    });
    
    // Validate we have data
    if (!rawData || rawData.length === 0) {
      throw new ExcelParsingError('Excel file contains no data rows');
    }
    
    // Normalize and validate each row
    const normalizedRecords: NormalizedAttendanceRecord[] = [];
    
    for (let i = 0; i < rawData.length; i++) {
      const row = rawData[i];
      const rowNumber = i + 2; // Excel row number (1-indexed, +1 for header)
      
      try {
        // Validate required fields exist
        if (!row['Employee Name'] || !row['Date'] || !row['In Time'] || !row['Out Time']) {
          // Skip empty rows (common at end of Excel files)
          if (!row['Employee Name'] && !row['Date']) {
            continue;
          }
          
          throw new DataValidationError(
            `Missing required fields (Employee Name, Date, In Time, or Out Time)`,
            rowNumber
          );
        }
        
        // Parse and normalize each field
        const employeeName = String(row['Employee Name']).trim();
        if (employeeName.length === 0) {
          throw new DataValidationError('Employee Name cannot be empty', rowNumber);
        }
        
        const date = parseExcelDate(row['Date']);
        const inTime = normalizeTimeString(row['In Time']);
        const outTime = normalizeTimeString(row['Out Time']);
        
        normalizedRecords.push({
          employeeName,
          date,
          inTime,
          outTime,
        });
      } catch (error) {
        if (error instanceof DataValidationError) {
          // Add row context to validation errors
          throw new DataValidationError(
            `Row ${rowNumber}: ${error.message}`,
            rowNumber
          );
        }
        throw error;
      }
    }
    
    if (normalizedRecords.length === 0) {
      throw new ExcelParsingError('No valid attendance records found in Excel file');
    }
    
    return normalizedRecords;
  } catch (error) {
    if (error instanceof ExcelParsingError || error instanceof DataValidationError) {
      throw error;
    }
    
    // Wrap unexpected errors
    throw new ExcelParsingError(
      'Failed to parse Excel file',
      error instanceof Error ? error : undefined
    );
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================
// Note: Database operations are performed inline within the transaction
// for optimal performance and type safety

// ============================================================================
// MAIN API ROUTE HANDLER
// ============================================================================

/**
 * POST /api/upload
 * 
 * Handle Excel file upload and process attendance records
 * 
 * WORKFLOW:
 * 1. Extract and validate file from FormData
 * 2. Parse Excel file and normalize data
 * 3. Group records by employee and detect month/year
 * 4. Upsert employees to get IDs
 * 5. Delete existing records for that month (idempotency)
 * 6. Process with gap filling (calculation engine)
 * 7. Batch insert all records
 * 8. Return success response with statistics
 * 
 * ERROR HANDLING:
 * - 400: Client errors (invalid file, bad data)
 * - 500: Server errors (database issues, unexpected failures)
 * 
 * @param {NextRequest} request - Next.js request object with FormData
 * @returns {Promise<NextResponse>} JSON response
 */
export async function POST(request: NextRequest): Promise<NextResponse<UploadSuccessResponse | UploadErrorResponse>> {
  try {
    // ========================================================================
    // STEP 1: EXTRACT AND VALIDATE FILE
    // ========================================================================
    
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: 'No file provided',
          details: 'Request must include a file in FormData with key "file"',
        },
        { status: 400 }
      );
    }
    
    // Validate file extension
    validateFileExtension(file.name);
    
    // Convert File to Buffer for xlsx processing
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // ========================================================================
    // STEP 2: PARSE EXCEL FILE
    // ========================================================================
    
    const normalizedRecords = parseExcelFile(buffer);
    
    console.log(`[Upload] Parsed ${normalizedRecords.length} records from Excel file`);
    
    // ========================================================================
    // STEP 3: DETECT MONTH/YEAR & GROUP BY EMPLOYEE
    // ========================================================================
    
    // Extract month/year from first valid date record
    const firstDate = normalizedRecords[0].date;
    const targetYear = firstDate.getFullYear();
    const targetMonth = firstDate.getMonth() + 1; // 1-12
    
    console.log(`[Upload] Processing attendance for ${targetYear}-${targetMonth.toString().padStart(2, '0')}`);
    
    // Group records by employee name
    const recordsByEmployee = new Map<string, NormalizedAttendanceRecord[]>();
    
    for (const record of normalizedRecords) {
      const existing = recordsByEmployee.get(record.employeeName) || [];
      existing.push(record);
      recordsByEmployee.set(record.employeeName, existing);
    }
    
    console.log(`[Upload] Found ${recordsByEmployee.size} unique employees`);
    
    // ========================================================================
    // STEP 4: PROCESS IN TRANSACTION FOR DATA CONSISTENCY
    // ========================================================================
    
    const result = await prisma.$transaction(async (tx) => {
      // ----------------------------------------------------------------------
      // STEP 4A: UPSERT EMPLOYEES AND GET IDS
      // ----------------------------------------------------------------------
      
      const employeeMap = new Map<string, string>(); // name -> id
      
      for (const [employeeName] of recordsByEmployee) {
        const employee = await tx.employee.upsert({
          where: { name: employeeName },
          update: {},
          create: { name: employeeName },
        });
        employeeMap.set(employeeName, employee.id);
      }
      
      console.log(`[Upload] Upserted ${employeeMap.size} employees`);
      
      // ----------------------------------------------------------------------
      // STEP 4B: DELETE EXISTING RECORDS FOR THIS MONTH
      // ----------------------------------------------------------------------
      // CRITICAL: This ensures idempotency - we can re-upload files without errors
      
      const employeeIds = Array.from(employeeMap.values());
      const startDate = new Date(targetYear, targetMonth - 1, 1);
      const endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);
      
      const deleteResult = await tx.attendanceRecord.deleteMany({
        where: {
          employeeId: { in: employeeIds },
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
      });
      
      console.log(`[Upload] Deleted ${deleteResult.count} existing records for ${targetYear}-${targetMonth}`);
      
      // ----------------------------------------------------------------------
      // STEP 4C: PROCESS EACH EMPLOYEE WITH GAP FILLING
      // ----------------------------------------------------------------------
      
      interface PrismaAttendanceRecord {
        employeeId: string;
        date: Date;
        inTime: string | null;
        outTime: string | null;
        workedHours: number;
        status: 'PRESENT' | 'ABSENT' | 'WEEKEND' | 'HOLIDAY';
      }
      
      const allProcessedRecords: PrismaAttendanceRecord[] = [];
      
      for (const [employeeName, records] of recordsByEmployee) {
        const employeeId = employeeMap.get(employeeName)!;
        
        // Convert to RawAttendanceInput format
        const rawRecords: RawAttendanceInput[] = records.map((record) => ({
          employeeId,
          date: record.date,
          inTime: record.inTime,
          outTime: record.outTime,
        }));
        
        // Apply calculation engine (gap filling + business logic)
        const processedRecords = processMonthlyAttendance(
          targetYear,
          targetMonth,
          rawRecords
        );
        
        // Transform to Prisma format
        const prismaRecords = processedRecords.map((record) => ({
          employeeId: record.employeeId,
          date: record.date,
          inTime: record.inTime,
          outTime: record.outTime,
          workedHours: record.workedHours,
          status: record.status,
        }));
        
        allProcessedRecords.push(...prismaRecords);
      }
      
      console.log(`[Upload] Processed ${allProcessedRecords.length} total records (with gap filling)`);
      
      // ----------------------------------------------------------------------
      // STEP 4D: BATCH INSERT ALL RECORDS
      // ----------------------------------------------------------------------
      // PERFORMANCE: Single createMany is vastly faster than individual creates
      
      const insertResult = await tx.attendanceRecord.createMany({
        data: allProcessedRecords,
        // We already deleted old records in this transaction, so no duplicates expected
      });
      
      console.log(`[Upload] Inserted ${insertResult.count} attendance records`);
      
      return {
        employeeCount: employeeMap.size,
        recordCount: insertResult.count,
        deletedCount: deleteResult.count,
      };
    });
    
    // ========================================================================
    // STEP 5: RETURN SUCCESS RESPONSE
    // ========================================================================
    
    return NextResponse.json(
      {
        success: true,
        count: result.recordCount,
        message: `Successfully processed ${result.recordCount} records for ${result.employeeCount} employees`,
        details: {
          employeeCount: result.employeeCount,
          recordCount: result.recordCount,
          month: targetMonth,
          year: targetYear,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    // ========================================================================
    // ERROR HANDLING WITH SPECIFIC STATUS CODES
    // ========================================================================
    
    console.error('[Upload] Error processing file:', error);
    
    // Client errors (400)
    if (
      error instanceof FileValidationError ||
      error instanceof DataValidationError ||
      error instanceof ExcelParsingError
    ) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          details: error instanceof DataValidationError && error.rowIndex
            ? `Error in Excel row ${error.rowIndex}`
            : undefined,
        },
        { status: 400 }
      );
    }
    
    // Calculation errors (400 - bad data)
    if (
      error instanceof InvalidTimeFormatError ||
      error instanceof InvalidDateError ||
      error instanceof CalculationError
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Data validation error',
          details: error.message,
        },
        { status: 400 }
      );
    }
    
    // Server errors (500)
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/upload
 * 
 * Return method not allowed for GET requests
 * This endpoint only accepts POST
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      success: false,
      error: 'Method not allowed',
      details: 'This endpoint only accepts POST requests with Excel file upload',
    },
    { status: 405 }
  );
}
