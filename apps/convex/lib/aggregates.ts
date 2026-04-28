/**
 * Aggregate definitions for efficient counting and summing.
 *
 * The communityPeople aggregate enables O(log n) count queries per group,
 * replacing the O(n) full-scan loop in communityPeople.count.
 */

import { TableAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import { DataModel } from "../_generated/dataModel";

/**
 * Aggregate for the communityPeople table, namespaced by groupId.
 *
 * Usage:
 *   - Count per group: `communityPeopleAggregate.count(ctx, { namespace: groupId })`
 *   - Must call .insert / .delete in every mutation that adds/removes rows.
 */
export const communityPeopleAggregate = new TableAggregate<{
  Namespace: string;
  Key: null;
  DataModel: DataModel;
  TableName: "communityPeople";
}>(components.communityPeopleAggregate, {
  namespace: (doc) => doc.groupId as string,
  sortKey: () => null,
});
