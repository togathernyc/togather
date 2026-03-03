import { useMemo } from "react";
import { isAnonymousGuest } from "../utils/attendanceUtils";

interface UseFilteredMembersProps {
  editMode: boolean;
  groupMembers: any[];
  localGuests: any[];
  attendanceReport: any;
  searchQuery: string;
  sortBy: string;
}

export function useFilteredMembers({
  editMode,
  groupMembers,
  localGuests,
  attendanceReport,
  searchQuery,
  sortBy,
}: UseFilteredMembersProps) {
  const filteredMembers = useMemo(() => {
    let members: any[] = [];

    if (editMode) {
      if (groupMembers.length > 0) {
        members = [...groupMembers];
      } else {
        const report = attendanceReport?.data || attendanceReport;
        const attendanceList = report?.attendances || [];
        if (attendanceList.length > 0) {
          members = [...attendanceList];
        }
      }

      // Add named guests (excluding anonymous)
      const namedGuests = localGuests.filter(
        (guest) => !isAnonymousGuest(guest)
      );

      if (namedGuests.length > 0) {
        members = [...members, ...namedGuests];
      }
    } else {
      const report = attendanceReport?.data || attendanceReport;
      const attendanceList = report?.attendances || [];
      if (attendanceList.length > 0) {
        members = attendanceList.filter(
          (member: any) => !isAnonymousGuest(member)
        );
      }
    }

    if (members.length === 0) return [];

    // Filter out anonymous guests
    let filtered = members.filter(
      (member: any) => !isAnonymousGuest(member)
    );

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((member: any) =>
        `${member.first_name} ${member.last_name}`.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    if (sortBy) {
      filtered.sort((a: any, b: any) => {
        const nameA = `${a.first_name} ${a.last_name}`;
        const nameB = `${b.first_name} ${b.last_name}`;

        if (sortBy === "last_name,first_name") {
          return nameA.localeCompare(nameB);
        } else if (sortBy === "-last_name,first_name") {
          return nameB.localeCompare(nameA);
        }
        return 0;
      });
    }

    return filtered;
  }, [
    editMode,
    groupMembers,
    localGuests,
    attendanceReport,
    searchQuery,
    sortBy,
  ]);

  return filteredMembers;
}

