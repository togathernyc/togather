import { GroupDetailScreen } from "@features/groups/components/GroupDetailScreen";
import { GroupInfoScreen } from "@features/groups/components/GroupInfoScreen";
import { useWhatsappShell } from "@hooks/useWhatsappShell";

// Flag-gated per docs/plans/church-migration-ui-redesign/README.md §9.5:
// whatsapp-shell on renders the W13 Group info page; off renders the
// existing, untouched GroupDetailScreen.
export default function GroupRoute() {
  const whatsappShell = useWhatsappShell();
  return whatsappShell ? <GroupInfoScreen /> : <GroupDetailScreen />;
}
