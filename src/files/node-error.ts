export function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return isNodeErrorWithCode(error, "ENOENT");
}

export function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return isNodeErrorWithCode(error, "EEXIST");
}
