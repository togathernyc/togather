interface RsvpOptionData {
  option: {
    id: number;
  };
  count?: number;
  users: unknown[];
}

interface RsvpData {
  total?: number;
  rsvps: RsvpOptionData[];
}

export function hasPrefetchedRsvpOptions(
  prefetchedData: { rsvpOptions?: unknown } | null | undefined
): boolean {
  return !!prefetchedData && Object.prototype.hasOwnProperty.call(prefetchedData, "rsvpOptions");
}

export function getRsvpStatsForOption(
  rsvpData: RsvpData | null | undefined,
  optionId: number
): { users: unknown[]; count: number; percentage: number } {
  if (!rsvpData?.rsvps) {
    return { users: [], count: 0, percentage: 0 };
  }

  const optionData = rsvpData.rsvps.find((item) => item.option.id === optionId);
  if (!optionData) {
    return { users: [], count: 0, percentage: 0 };
  }

  const totalResponses =
    rsvpData.total ??
    rsvpData.rsvps.reduce((sum, option) => sum + (option.count ?? option.users.length), 0);
  const count = optionData.count ?? optionData.users.length;
  const percentage = totalResponses > 0 ? (count / totalResponses) * 100 : 0;

  return {
    users: optionData.users,
    count,
    percentage,
  };
}
