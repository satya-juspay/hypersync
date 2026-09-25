const DEVQA_TICKET_BRANCH =
  /(?:^|\/)devqa-(PICAF|HYPSDK)-(\d+)(?:-.+)?$/i;

const DEVQA_PROJECTS = ["PICAF", "HYPSDK"] as const;

export function extractDevQaTicketNumber(branch?: string | null) {
  const match = branch?.trim().match(DEVQA_TICKET_BRANCH);

  if (!match) return null;

  return match[2];
}

export function devQaTicketBranchPrefixes(ticketNumber: string) {
  return DEVQA_PROJECTS.map(
    (project) => `devqa-${project}-${ticketNumber}`
  );
}
