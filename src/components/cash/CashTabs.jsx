// The tabs of the cash desk, for the administrator and the associés: « Caisse » (everything), « Boutique » (the
// counter sales) and « Offerts » (the products given away, at cost price). « Caisse » is exact: /caisse/boutique must not light it up as well.
import { RouteTabs } from '../ui/ui.jsx';

export default function CashTabs() {
  return (
    <RouteTabs
      label="Rubriques de la caisse"
      items={[
        ['/caisse', 'Caisse', 'cash', true],
        ['/caisse/boutique', 'Boutique', 'shop'],
        ['/caisse/offerts', 'Offerts', 'receipt'],
      ]}
    />
  );
}
