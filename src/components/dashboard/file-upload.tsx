/**
 * File Upload Component for Excel Attendance Data
 * 
 * This component provides a professional, accessible interface for uploading
 * Excel files containing employee attendance records. It handles file validation,
 * upload progress tracking, and comprehensive error handling.
 * 
 * FEATURES:
 * - File type validation (.xlsx, .xls only)
 * - Real-time upload progress indication
 * - Toast notifications for success/error states
 * - Accessible keyboard navigation
 * - Professional visual feedback during all states
 * 
 * DEPENDENCIES:
 * - shadcn/ui components (Button, Card, Progress, Alert)
 * - sonner for toast notifications
 * - lucide-react for icons
 * 
 * SECURITY:
 * - Client-side file type validation
 * - File size limits enforced by browser and server
 * - Secure FormData transmission
 * 
 * @module components/dashboard/file-upload
 * @author Principal Software Engineer
 * @version 1.0.0
 */

'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { UploadCloud, FileSpreadsheet, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Component props interface
 */
export interface FileUploadProps {
  /**
   * Callback function invoked after successful upload
   * Use this to refresh data or navigate to results page
   */
  onUploadSuccess?: () => void;
  
  /**
   * Optional CSS class name for custom styling
   */
  className?: string;
  
  /**
   * Optional maximum file size in bytes
   * @default 10485760 (10MB)
   */
  maxFileSizeBytes?: number;
}

/**
 * API response for successful upload
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
 * API response for upload errors
 */
interface UploadErrorResponse {
  success: false;
  error: string;
  details?: string;
}

/**
 * Upload state enumeration for better type safety
 */
type UploadState = 'idle' | 'uploading' | 'success' | 'error';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Allowed file extensions for Excel files
 */
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'] as const;

/**
 * Default maximum file size (10MB)
 */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate file extension
 * 
 * @param {string} filename - Name of the file
 * @returns {boolean} True if extension is allowed
 */
function isValidFileExtension(filename: string): boolean {
  const lowerFilename = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext));
}

/**
 * Validate file size
 * 
 * @param {number} fileSize - Size of file in bytes
 * @param {number} maxSize - Maximum allowed size in bytes
 * @returns {boolean} True if size is within limit
 */
function isValidFileSize(fileSize: number, maxSize: number): boolean {
  return fileSize > 0 && fileSize <= maxSize;
}

/**
 * Format file size for human-readable display
 * 
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size string (e.g., "2.5 MB")
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * FileUpload Component
 * 
 * Professional file upload interface with comprehensive validation,
 * progress tracking, and error handling.
 * 
 * USAGE:
 * ```tsx
 * <FileUpload
 *   onUploadSuccess={() => {
 *     // Refresh data or navigate
 *     router.refresh();
 *   }}
 * />
 * ```
 * 
 * ACCESSIBILITY:
 * - Keyboard navigable
 * - ARIA labels for screen readers
 * - Visual feedback for all states
 * - Error messages announced to screen readers
 */
export function FileUpload({
  onUploadSuccess,
  className,
  maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE,
}: FileUploadProps): React.JSX.Element {
  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================
  
  const router = useRouter();
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [uploadDetails, setUploadDetails] = useState<UploadSuccessResponse['details'] | null>(null);
  
  // File input ref for programmatic triggering
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // ==========================================================================
  // COMPUTED VALUES
  // ==========================================================================
  
  const isUploading = uploadState === 'uploading';
  const isSuccess = uploadState === 'success';
  const isError = uploadState === 'error';
  const isIdle = uploadState === 'idle';
  
  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================
  
  /**
   * Handle file selection from input
   * 
   * Validates file type and size before accepting.
   * Provides immediate feedback for validation failures.
   * 
   * @param {React.ChangeEvent<HTMLInputElement>} event - File input change event
   */
  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const files = event.target.files;
      
      // Reset state
      setErrorMessage('');
      setUploadState('idle');
      setUploadProgress(0);
      setUploadDetails(null);
      
      if (!files || files.length === 0) {
        setSelectedFile(null);
        return;
      }
      
      const file = files[0];
      
      // Validate file extension
      if (!isValidFileExtension(file.name)) {
        const error = `Invalid file type. Please select an Excel file (${ALLOWED_EXTENSIONS.join(', ')})`;
        setErrorMessage(error);
        setUploadState('error');
        toast.error('Invalid File Type', {
          description: error,
        });
        setSelectedFile(null);
        return;
      }
      
      // Validate file size
      if (!isValidFileSize(file.size, maxFileSizeBytes)) {
        const error = `File size (${formatFileSize(file.size)}) exceeds maximum allowed size (${formatFileSize(maxFileSizeBytes)})`;
        setErrorMessage(error);
        setUploadState('error');
        toast.error('File Too Large', {
          description: error,
        });
        setSelectedFile(null);
        return;
      }
      
      // File is valid
      setSelectedFile(file);
      toast.success('File Selected', {
        description: `${file.name} (${formatFileSize(file.size)})`,
      });
    },
    [maxFileSizeBytes]
  );
  
  /**
   * Handle file upload to server
   * 
   * Performs the following:
   * 1. Creates FormData with selected file
   * 2. Sends POST request to /api/upload
   * 3. Tracks upload progress (simulated)
   * 4. Handles success/error responses
   * 5. Invokes callback on success
   * 
   * ERROR HANDLING:
   * - Network errors: Displays generic error message
   * - Server errors (400/500): Displays server error message
   * - Parsing errors: Displays error with details
   * 
   * @async
   * @returns {Promise<void>}
   */
  const handleUpload = useCallback(async (): Promise<void> => {
    if (!selectedFile) {
      toast.error('No File Selected', {
        description: 'Please select an Excel file to upload',
      });
      return;
    }
    
    // Reset error state
    setErrorMessage('');
    setUploadState('uploading');
    setUploadProgress(0);
    
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', selectedFile);
      
      // Simulate progress (real progress requires server-side streaming)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 200);
      
      // Send POST request to upload API
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        // Note: Don't set Content-Type header - browser sets it automatically with boundary
      });
      
      // Clear progress interval
      clearInterval(progressInterval);
      setUploadProgress(100);
      
      // Parse JSON response
      const data: UploadSuccessResponse | UploadErrorResponse = await response.json();
      
      if (!response.ok) {
        // Handle error response (400, 500, etc.)
        const errorData = data as UploadErrorResponse;
        const errorMsg = errorData.details
          ? `${errorData.error}: ${errorData.details}`
          : errorData.error;
        
        throw new Error(errorMsg);
      }
      
      // Success response
      const successData = data as UploadSuccessResponse;
      
      setUploadState('success');
      setUploadDetails(successData.details);
      
      // Show success toast
      toast.success('Upload Successful', {
        description: successData.message,
        duration: 5000,
      });
      
      // Refresh server data and invoke success callback
      setTimeout(() => {
        router.refresh(); // Trigger server-side data refetch
        onUploadSuccess?.();
      }, 1000);
      
    } catch (error) {
      // Handle any errors (network, parsing, server errors)
      const errorMsg = error instanceof Error
        ? error.message
        : 'An unexpected error occurred during upload';
      
      console.error('[FileUpload] Upload error:', error);
      
      setUploadState('error');
      setErrorMessage(errorMsg);
      setUploadProgress(0);
      
      // Show error toast
      toast.error('Upload Failed', {
        description: errorMsg,
        duration: 7000,
      });
    }
  }, [selectedFile, onUploadSuccess, router]);
  
  /**
   * Trigger file input click programmatically
   * Provides better UX than default file input styling
   */
  const handleSelectFileClick = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);
  
  /**
   * Reset component to initial state
   * Allows user to upload another file
   */
  const handleReset = useCallback((): void => {
    setSelectedFile(null);
    setUploadState('idle');
    setUploadProgress(0);
    setErrorMessage('');
    setUploadDetails(null);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);
  
  // ==========================================================================
  // RENDER
  // ==========================================================================
  
  return (
    <Card className={cn('w-full max-w-2xl', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Upload Attendance Data
        </CardTitle>
        <CardDescription>
          Upload an Excel file (.xlsx or .xls) containing employee attendance records.
          The file should include columns: Employee Name, Date, In Time, Out Time.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_EXTENSIONS.join(',')}
          onChange={handleFileChange}
          className="hidden"
          aria-label="Select Excel file"
          disabled={isUploading}
        />
        
        {/* Upload Area */}
        <div
          className={cn(
            'relative border-2 border-dashed rounded-lg p-8 transition-colors',
            isIdle && 'border-muted-foreground/25 hover:border-muted-foreground/50 cursor-pointer',
            isUploading && 'border-primary/50 bg-primary/5',
            isSuccess && 'border-green-500/50 bg-green-50 dark:bg-green-950',
            isError && 'border-destructive/50 bg-destructive/5'
          )}
          onClick={isIdle && !selectedFile ? handleSelectFileClick : undefined}
          role="button"
          tabIndex={isIdle && !selectedFile ? 0 : -1}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && isIdle && !selectedFile) {
              e.preventDefault();
              handleSelectFileClick();
            }
          }}
          aria-label="File upload area"
        >
          <div className="flex flex-col items-center justify-center space-y-4 text-center">
            {/* Icon */}
            {isIdle && !selectedFile && (
              <>
                <UploadCloud className="h-12 w-12 text-muted-foreground" />
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Click to select or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Excel files only (.xlsx, .xls) • Max {formatFileSize(maxFileSizeBytes)}
                  </p>
                </div>
              </>
            )}
            
            {isIdle && selectedFile && (
              <>
                <FileSpreadsheet className="h-12 w-12 text-primary" />
                <div className="space-y-2">
                  <p className="text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
              </>
            )}
            
            {isUploading && (
              <>
                <Loader2 className="h-12 w-12 text-primary animate-spin" />
                <div className="space-y-2">
                  <p className="text-sm font-medium">Uploading and processing...</p>
                  <p className="text-xs text-muted-foreground">
                    This may take a few moments
                  </p>
                </div>
              </>
            )}
            
            {isSuccess && (
              <>
                <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-400" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-green-600 dark:text-green-400">
                    Upload Successful!
                  </p>
                  {uploadDetails && (
                    <p className="text-xs text-muted-foreground">
                      Processed {uploadDetails.recordCount} records for{' '}
                      {uploadDetails.employeeCount} employees ({uploadDetails.month}/{uploadDetails.year})
                    </p>
                  )}
                </div>
              </>
            )}
            
            {isError && (
              <>
                <XCircle className="h-12 w-12 text-destructive" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-destructive">Upload Failed</p>
                  <p className="text-xs text-muted-foreground">Please check the error below</p>
                </div>
              </>
            )}
          </div>
        </div>
        
        {/* Progress Bar */}
        {isUploading && (
          <div className="space-y-2">
            <Progress value={uploadProgress} className="h-2" />
            <p className="text-xs text-center text-muted-foreground">
              {uploadProgress}% complete
            </p>
          </div>
        )}
        
        {/* Error Alert */}
        {isError && errorMessage && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription className="text-sm">
              {errorMessage}
            </AlertDescription>
          </Alert>
        )}
        
        {/* Success Alert */}
        {isSuccess && uploadDetails && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertTitle className="text-green-600 dark:text-green-400">
              Processing Complete
            </AlertTitle>
            <AlertDescription className="text-sm text-green-600 dark:text-green-400">
              Successfully uploaded and processed attendance data for{' '}
              <strong>{uploadDetails.month}/{uploadDetails.year}</strong>.
              Created {uploadDetails.recordCount} records for{' '}
              {uploadDetails.employeeCount} employees.
            </AlertDescription>
          </Alert>
        )}
        
        {/* Action Buttons */}
        <div className="flex gap-2 justify-end">
          {(isIdle || isError) && (
            <>
              {selectedFile && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSelectFileClick}
                    disabled={isUploading}
                  >
                    Change File
                  </Button>
                  <Button
                    type="button"
                    onClick={handleUpload}
                    disabled={isUploading}
                    className="min-w-32"
                  >
                    <UploadCloud className="mr-2 h-4 w-4" />
                    Upload
                  </Button>
                </>
              )}
              
              {!selectedFile && (
                <Button
                  type="button"
                  onClick={handleSelectFileClick}
                  disabled={isUploading}
                >
                  Select File
                </Button>
              )}
            </>
          )}
          
          {isSuccess && (
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
            >
              Upload Another File
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
