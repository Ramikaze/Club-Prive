// The text of the period button on phones (PeriodPicker): the name of the preset shown, else its dates, the years
// only when the two ends are not in the same year. Pure: tested by test/period-label.test.js.
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayMonthYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const utc = (date) => new Date(`${date}T00:00:00Z`);

export function periodButtonLabel(from, to, presets) {
  const preset = presets.find((p) => p.from === from && p.to === to);
  if (preset) return preset.label;
  if (from === to) return dayMonth.format(utc(from));
  const fmt = from.slice(0, 4) === to.slice(0, 4) ? dayMonth : dayMonthYear;
  return `${fmt.format(utc(from))} – ${fmt.format(utc(to))}`;
}
