import { createHash } from "node:crypto";

const FINGERPRINT_VERSION = "v2";

export type PatchScore = {
  mainPrId: string;
  score: number;
  matchedFiles: number;
  totalFiles: number;
  matchedAddedLines: number;
  totalAddedLines: number;
  matchedRemovedLines: number;
  totalRemovedLines: number;
};

export type PatchScoreCandidate = {
  mainPrId: string;
  patchFingerprint?: string | null;
};

type ParsedPatchFingerprint = {
  files: Set<string>;
  addedLines: Set<string>;
  removedLines: Set<string>;
};

export function createPatchFingerprint(diff: string) {
  const files = new Set<string>();
  const addedLines = new Set<string>();
  const removedLines = new Set<string>();
  let filePath = "";

  for (const rawLine of diff.split("\n")) {
    const line = rawLine.trimEnd();

    if (line.startsWith("+++ ")) {
      filePath = line.replace(/^\+\+\+\s+b\//, "").replace(/^\+\+\+\s+/, "");
      continue;
    }

    if (line.startsWith("--- ")) {
      continue;
    }

    if (!line.startsWith("+") && !line.startsWith("-")) {
      continue;
    }

    const normalizedLine = line.replace(/\s+/g, " ").trim();

    if (normalizedLine) {
      const rawToken = `${filePath}\t${normalizedLine}`;
      files.add(fileToken(filePath));
      if (normalizedLine.startsWith("+")) {
        addedLines.add(`A:${hashToken(rawToken)}`);
      } else {
        removedLines.add(`R:${hashToken(rawToken)}`);
      }
    }
  }

  return [
    FINGERPRINT_VERSION,
    ...[...files].sort(),
    ...[...addedLines].sort(),
    ...[...removedLines].sort(),
  ].join("\n");
}

export function findPatchMatchesFromFingerprints(
  releaseFingerprint: string | null | undefined,
  candidates: PatchScoreCandidate[],
  options: { minScore?: number } = {}
) {
  const minScore = options.minScore ?? 0.6;

  if (!releaseFingerprint) {
    return [];
  }

  const releasePatch = parsePatchFingerprint(releaseFingerprint);
  const releaseChangedLines =
    releasePatch.addedLines.size + releasePatch.removedLines.size;

  if (releaseChangedLines === 0) {
    return [];
  }

  return candidates
    .map((candidate) => {
      if (!candidate.patchFingerprint) {
        return null;
      }

      const candidatePatch = parsePatchFingerprint(candidate.patchFingerprint);
      const score = scorePatchSimilarity(
        releasePatch,
        candidatePatch,
        candidate.mainPrId
      );

      return score.score > minScore ? score : null;
    })
    .filter((score): score is PatchScore => score !== null)
    .sort((a, b) => b.score - a.score);
}

function parsePatchFingerprint(fingerprint: string): ParsedPatchFingerprint {
  const files = new Set<string>();
  const addedLines = new Set<string>();
  const removedLines = new Set<string>();
  const lines = fingerprint.split("\n");

  if (lines[0] === FINGERPRINT_VERSION) {
    for (const line of lines.slice(1)) {
      if (line.startsWith("F:")) files.add(line);
      else if (line.startsWith("A:")) addedLines.add(line);
      else if (line.startsWith("R:")) removedLines.add(line);
    }
    return { files, addedLines, removedLines };
  }

  // Convert legacy raw fingerprints to the same tokens in memory so old and
  // new rows remain comparable while refresh gradually rewrites them.
  for (const line of lines) {
    const separatorIndex = line.lastIndexOf("\t");
    if (separatorIndex === -1) continue;

    const filePath = line.slice(0, separatorIndex);
    const changedLine = line.slice(separatorIndex + 1);

    files.add(fileToken(filePath));

    if (changedLine.startsWith("+")) {
      addedLines.add(`A:${hashToken(line)}`);
    } else if (changedLine.startsWith("-")) {
      removedLines.add(`R:${hashToken(line)}`);
    }
  }

  return { files, addedLines, removedLines };
}

function fileToken(filePath: string) {
  return `F:${hashToken(filePath)}`;
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function scorePatchSimilarity(
  releasePatch: ParsedPatchFingerprint,
  candidatePatch: ParsedPatchFingerprint,
  candidateMainPrId: string
): PatchScore {
  const matchedFiles = countIntersection(releasePatch.files, candidatePatch.files);
  const matchedAddedLines = countIntersection(
    releasePatch.addedLines,
    candidatePatch.addedLines
  );
  const matchedRemovedLines = countIntersection(
    releasePatch.removedLines,
    candidatePatch.removedLines
  );
  const fileOverlap = ratio(matchedFiles, releasePatch.files.size);
  const addedLineOverlap = ratio(matchedAddedLines, releasePatch.addedLines.size);
  const removedLineOverlap = ratio(
    matchedRemovedLines,
    releasePatch.removedLines.size
  );
  const score =
    fileOverlap * 0.3 + addedLineOverlap * 0.5 + removedLineOverlap * 0.2;

  return {
    mainPrId: candidateMainPrId,
    score: Number(score.toFixed(4)),
    matchedFiles,
    totalFiles: releasePatch.files.size,
    matchedAddedLines,
    totalAddedLines: releasePatch.addedLines.size,
    matchedRemovedLines,
    totalRemovedLines: releasePatch.removedLines.size,
  };
}

function countIntersection<T>(left: Set<T>, right: Set<T>): number {
  let count = 0;

  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }

  return count;
}

function ratio(matched: number, total: number): number {
  return total === 0 ? 1 : matched / total;
}
