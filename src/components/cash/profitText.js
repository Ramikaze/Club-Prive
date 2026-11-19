// The sentence under the real profit that says what it leaves out (pure, no JSX, no store: `money` formats an amount,
// so that it is tested without the store). `m` is the report's `missing` ({ sales_count, sales_amount, gifts_count }).
// null when nothing is left out. Only cancellations of sales without a cost price on the period (count 0, amount
// below 0) never read « 0 vente ».
export function missingText(m, money) {
  const parts = [];
  if (m.sales_count > 0) {
    const many = m.sales_count > 1;
    parts.push(`${m.sales_count} vente${many ? 's' : ''} (${money(m.sales_amount)}) sans prix de revient ${many ? 'ne sont pas comptées' : 'n’est pas comptée'}`);
  } else if (m.sales_amount !== 0) {
    parts.push(`Des ventes sans prix de revient annulées (${money(m.sales_amount)}) ne sont pas comptées`);
  }
  if (m.gifts_count > 0) parts.push(`${m.gifts_count} produit${m.gifts_count > 1 ? 's' : ''} offert${m.gifts_count > 1 ? 's' : ''} sans prix de revient`);
  return parts.length ? `${parts.join(' ; ')}.` : null;
}
