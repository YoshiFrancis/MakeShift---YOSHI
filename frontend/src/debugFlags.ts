/** Shared developer switches. Diagnostics are hidden unless explicitly enabled at build time. */
export const DEBUG_FLAGS = {
  pipelineDiagnostics: process.env.NEXT_PUBLIC_PIPELINE_DIAGNOSTICS === "1",
  // Preserve main's current CV debugging behavior until its owner changes it.
  visualDebug: true,
  showZLines: true,
  showSheetWithoutCalibration: true,
} as const;
