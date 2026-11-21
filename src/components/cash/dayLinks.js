// A day of « Journées à vérifier » opens the cash page on that day alone, scrolled to « Recette du jour par
// catégorie », whose bar closes and verifies the day shown (owner's request, 2026-11-21). Pure: no React, no store.

export const dayLink = (day) => `/caisse?from=${day}&to=${day}&type=jour`;

// The day the closing bar acts on: the day shown when the page shows one day, today otherwise.
export const closingDayOf = (from, to, today) => (from === to ? from : today);
