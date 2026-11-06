// The two tabs of « Membres / Clients ».
import { RouteTabs } from '../ui/ui.jsx';

export default function MembersTabs() {
  return (
    <RouteTabs
      label="Membres et clients réguliers"
      items={[
        ['/membres', 'Membres', 'users'],
        ['/clients', 'Clients réguliers', 'users'],
      ]}
    />
  );
}
