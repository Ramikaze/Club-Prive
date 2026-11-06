// The two tabs of the cash desk, for the administrator and the associés: « Caisse » (everything) and « Boutique »
// (the counter sales). « Caisse » is exact: /caisse/boutique must not light it up as well.
import { RouteTabs } from '../ui/ui.jsx';

export default function CashTabs() {
  return (
    <RouteTabs
      label="Rubriques de la caisse"
      items={[
        ['/caisse', 'Caisse', 'cash', true],
        ['/caisse/boutique', 'Boutique', 'shop'],
      ]}
    />
  );
}
