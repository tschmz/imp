import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const APPLY_PATCH_PARAMETERS = {
  type: "object",
  properties: {
    patch: {
      type: "string",
      minLength: 1,
      description: [
        "Patch text in Codex apply_patch format.",
        "It must start with *** Begin Patch and end with *** End Patch.",
        "Supported hunks are *** Add File, *** Delete File, and *** Update File with optional *** Move to.",
      ].join(" "),
    },
  },
  required: ["patch"],
  additionalProperties: false,
};

export function createApplyPatchTool() {
  return {
    name: "apply_patch",
    label: "apply_patch",
    description: "Apply file edits using the Codex apply_patch patch format.",
    parameters: APPLY_PATCH_PARAMETERS,
    executionMode: "sequential",
    prepareArguments(args) {
      if (typeof args === "string") {
        return { patch: args };
      }

      if (isRecord(args) && typeof args.input === "string" && args.patch === undefined) {
        return { patch: args.input };
      }

      return args;
    },
    async execute(_toolCallId, params) {
      const { patch } = parseApplyPatchParams(params);
      const result = await applyCodexPatch(patch);
      return {
        content: [{ type: "text", text: renderApplyPatchResult(result) }],
        details: result,
      };
    },
  };
}

export async function applyCodexPatch(patch, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const operations = parseCodexPatch(patch);
  const files = new Map();
  const results = [];

  for (const operation of operations) {
    const result = await applyOperation(operation, files, cwd);
    results.push(result);
  }

  for (const [path, file] of files) {
    if (file.exists) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content, "utf8");
    } else {
      await rm(path, { force: true });
    }
  }

  return {
    counts: countResults(results),
    files: results,
  };
}

function parseApplyPatchParams(params) {
  if (!isRecord(params)) {
    throw new Error("apply_patch requires an object parameter with a patch string.");
  }

  if (typeof params.patch !== "string" || params.patch.length === 0) {
    throw new Error("apply_patch requires a non-empty patch string.");
  }

  return { patch: params.patch };
}

function parseCodexPatch(patch) {
  const lines = splitPatchLines(patch);
  if (lines[0] !== "*** Begin Patch") {
    throw new Error("apply_patch patch must start with *** Begin Patch.");
  }

  if (lines[lines.length - 1] !== "*** End Patch") {
    throw new Error("apply_patch patch must end with *** End Patch.");
  }

  const operations = [];
  let index = 1;
  while (index < lines.length - 1) {
    const line = lines[index];
    if (line.startsWith("*** Add File: ")) {
      const parsed = parseAddOperation(lines, index);
      operations.push(parsed.operation);
      index = parsed.nextIndex;
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      operations.push({
        type: "delete",
        path: parseHeaderPath(line, "*** Delete File: ", index),
      });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const parsed = parseUpdateOperation(lines, index);
      operations.push(parsed.operation);
      index = parsed.nextIndex;
      continue;
    }

    throw new Error(`apply_patch expected a file hunk header at line ${index + 1}.`);
  }

  if (operations.length === 0) {
    throw new Error("apply_patch patch must contain at least one file hunk.");
  }

  return operations;
}

function splitPatchLines(patch) {
  const normalized = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function parseAddOperation(lines, index) {
  const path = parseHeaderPath(lines[index], "*** Add File: ", index);
  const contentLines = [];
  index += 1;

  while (index < lines.length - 1 && !isOperationHeader(lines[index])) {
    const line = lines[index];
    if (!line.startsWith("+")) {
      throw new Error(`apply_patch add hunk for ${path} expected + lines at line ${index + 1}.`);
    }

    contentLines.push(line.slice(1));
    index += 1;
  }

  if (contentLines.length === 0) {
    throw new Error(`apply_patch add hunk for ${path} must contain at least one + line.`);
  }

  return {
    operation: {
      type: "add",
      path,
      content: `${contentLines.join("\n")}\n`,
    },
    nextIndex: index,
  };
}

function parseUpdateOperation(lines, index) {
  const path = parseHeaderPath(lines[index], "*** Update File: ", index);
  const hunks = [];
  let moveTo;
  let currentHunk;
  index += 1;

  if (index < lines.length - 1 && lines[index].startsWith("*** Move to: ")) {
    moveTo = parseHeaderPath(lines[index], "*** Move to: ", index);
    index += 1;
  }

  while (index < lines.length - 1 && !isOperationHeader(lines[index])) {
    const line = lines[index];
    if (line === "*** End of File") {
      index += 1;
      break;
    }

    if (line.startsWith("@@")) {
      currentHunk = {
        marker: line.slice(2).trim(),
        actions: [],
      };
      hunks.push(currentHunk);
      index += 1;
      continue;
    }

    const prefix = line[0];
    if (prefix === " " || prefix === "+" || prefix === "-") {
      if (!currentHunk) {
        currentHunk = { marker: "", actions: [] };
        hunks.push(currentHunk);
      }

      currentHunk.actions.push({
        type: prefix === " " ? "context" : prefix === "+" ? "add" : "delete",
        text: line.slice(1),
      });
      index += 1;
      continue;
    }

    throw new Error(`apply_patch update hunk for ${path} has invalid line ${index + 1}.`);
  }

  if (!moveTo && hunks.every((hunk) => hunk.actions.length === 0)) {
    throw new Error(`apply_patch update hunk for ${path} must include a move or changes.`);
  }

  return {
    operation: {
      type: "update",
      path,
      moveTo,
      hunks,
    },
    nextIndex: index,
  };
}

function parseHeaderPath(line, prefix, index) {
  const path = line.slice(prefix.length).trim();
  if (path.length === 0) {
    throw new Error(`apply_patch header at line ${index + 1} requires a file path.`);
  }

  return path;
}

function isOperationHeader(line) {
  return (
    line.startsWith("*** Add File: ") ||
    line.startsWith("*** Delete File: ") ||
    line.startsWith("*** Update File: ")
  );
}

async function applyOperation(operation, files, cwd) {
  if (operation.type === "add") {
    return applyAddOperation(operation, files, cwd);
  }

  if (operation.type === "delete") {
    return applyDeleteOperation(operation, files, cwd);
  }

  return applyUpdateOperation(operation, files, cwd);
}

async function applyAddOperation(operation, files, cwd) {
  const path = resolvePatchPath(operation.path, cwd);
  if (await virtualFileExists(path, files)) {
    throw new Error(`apply_patch cannot add ${operation.path}: file already exists.`);
  }

  files.set(path, { exists: true, content: operation.content });
  return { action: "added", path };
}

async function applyDeleteOperation(operation, files, cwd) {
  const path = resolvePatchPath(operation.path, cwd);
  if (!await virtualFileExists(path, files)) {
    throw new Error(`apply_patch cannot delete ${operation.path}: file does not exist.`);
  }

  files.set(path, { exists: false });
  return { action: "deleted", path };
}

async function applyUpdateOperation(operation, files, cwd) {
  const path = resolvePatchPath(operation.path, cwd);
  const content = await readVirtualFile(path, files);
  if (content === undefined) {
    throw new Error(`apply_patch cannot update ${operation.path}: file does not exist.`);
  }

  const updated = applyUpdateHunks(content, operation.hunks, operation.path);
  if (!operation.moveTo) {
    files.set(path, { exists: true, content: updated });
    return { action: "updated", path };
  }

  const moveTo = resolvePatchPath(operation.moveTo, cwd);
  if (moveTo !== path && await virtualFileExists(moveTo, files)) {
    throw new Error(`apply_patch cannot move ${operation.path} to ${operation.moveTo}: target already exists.`);
  }

  files.set(path, { exists: false });
  files.set(moveTo, { exists: true, content: updated });
  return { action: "moved", path, moveTo };
}

function applyUpdateHunks(content, hunks, path) {
  const parsedContent = splitFileContent(content);
  const lines = [...parsedContent.lines];
  let searchStart = 0;

  for (const hunk of hunks) {
    if (hunk.actions.length === 0) {
      continue;
    }

    const oldBlock = hunk.actions
      .filter((action) => action.type !== "add")
      .map((action) => action.text);
    const newBlock = hunk.actions
      .filter((action) => action.type !== "delete")
      .map((action) => action.text);
    const markerIndex = hunk.marker ? findMarker(lines, hunk.marker, searchStart) : -1;
    const hunkSearchStart = markerIndex >= 0 ? markerIndex : searchStart;
    const index = oldBlock.length === 0
      ? hunkSearchStart
      : findBlock(lines, oldBlock, hunkSearchStart) ?? findBlock(lines, oldBlock, 0);

    if (index === undefined || index < 0) {
      throw new Error(
        [
          `apply_patch verification failed: Failed to find expected lines in ${path}:`,
          ...oldBlock.map((line) => ` ${line}`),
        ].join("\n"),
      );
    }

    lines.splice(index, oldBlock.length, ...newBlock);
    searchStart = index + newBlock.length;
  }

  return joinFileContent(lines, parsedContent.newline, parsedContent.hasFinalNewline);
}

function splitFileContent(content) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hasFinalNewline = normalized.endsWith("\n");
  const lines = normalized.length === 0 ? [] : normalized.split("\n");
  if (hasFinalNewline) {
    lines.pop();
  }

  return { lines, newline, hasFinalNewline };
}

function joinFileContent(lines, newline, hasFinalNewline) {
  if (lines.length === 0) {
    return hasFinalNewline ? newline : "";
  }

  return `${lines.join(newline)}${hasFinalNewline ? newline : ""}`;
}

function findMarker(lines, marker, start) {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].includes(marker)) {
      return index;
    }
  }

  return -1;
}

function findBlock(lines, block, start) {
  if (block.length === 0) {
    return start;
  }

  for (let index = start; index <= lines.length - block.length; index += 1) {
    if (block.every((line, offset) => lines[index + offset] === line)) {
      return index;
    }
  }

  return undefined;
}

async function virtualFileExists(path, files) {
  if (files.has(path)) {
    return files.get(path).exists;
  }

  const info = await stat(path).catch((error) => {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  });

  if (info === undefined) {
    return false;
  }

  if (!info.isFile()) {
    throw new Error(`apply_patch target is not a file: ${path}`);
  }

  return true;
}

async function readVirtualFile(path, files) {
  if (files.has(path)) {
    const file = files.get(path);
    return file.exists ? file.content : undefined;
  }

  return readFile(path, "utf8").catch((error) => {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  });
}

function resolvePatchPath(path, cwd) {
  return resolve(cwd, path);
}

function countResults(results) {
  return {
    added: results.filter((result) => result.action === "added").length,
    updated: results.filter((result) => result.action === "updated").length,
    deleted: results.filter((result) => result.action === "deleted").length,
    moved: results.filter((result) => result.action === "moved").length,
  };
}

function renderApplyPatchResult(result) {
  const parts = [
    formatCount(result.counts.added, "added"),
    formatCount(result.counts.updated, "updated"),
    formatCount(result.counts.deleted, "deleted"),
    formatCount(result.counts.moved, "moved"),
  ].filter(Boolean);
  const summary = parts.length > 0 ? parts.join(", ") : "no changes";
  const files = result.files.map(renderAppliedFile).join("\n");
  return files ? `Applied patch: ${summary}.\n${files}` : `Applied patch: ${summary}.`;
}

function formatCount(count, label) {
  return count > 0 ? `${count} ${label}` : undefined;
}

function renderAppliedFile(file) {
  if (file.action === "moved") {
    return `- moved ${file.path} -> ${file.moveTo}`;
  }

  return `- ${file.action} ${file.path}`;
}

function isMissingFileError(error) {
  return error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
