// The 80 mm roll the papers of the till print on: the cash receipt (Ticket.jsx) and the booking confirmation
// (BookingConfirmation.jsx). Both draw their paper as `.ticket-sheet` and share these print rules (club.css).
import { useEffect } from 'react';

// The injected <style> that sets the roll's paper size, and the body class that lets the paper print. The paper
// prints only while `ticket-armed` is on the body. The cash receipt sets it right before window.print(), once the
// server has numbered the copy: the browser's own print command (Ctrl+P, menu, Share) finds it off and prints a
// notice instead, so no copy label that the server has not recorded can leave the club.
export const PAGE_STYLE_ID = 'ticket-page-size';
export const ARMED = 'ticket-armed';
const MM_PER_PX = 25.4 / 96;

// The roll is 80 mm wide and as long as the paper drawn: `size: 80mm auto` is not valid CSS (Chrome drops it),
// so the length is measured on the rendered sheet (+ about 4 mm) just before printing.
export function setRollLength() {
  const sheet = document.querySelector('.ticket-sheet');
  const style = document.getElementById(PAGE_STYLE_ID);
  if (!sheet || !style) return;
  const height = Math.ceil(sheet.offsetHeight * MM_PER_PX) + 4;
  style.textContent = `@page { size: 80mm ${height}mm; margin: 0; }`;
}

// The roll size (@page) applies to the whole printout and cannot be limited to a class, so it exists only
// while a paper's page is open: the member card keeps its own page size (the roll's length is set at print time,
// see setRollLength). The body class scopes the page's other print rules in club.css.
export function useRollPage() {
  useEffect(() => {
    document.body.classList.add('print-ticket');
    const style = document.createElement('style');
    style.id = PAGE_STYLE_ID;
    style.textContent = '@page { margin: 0; }';
    document.head.append(style);
    return () => {
      document.body.classList.remove('print-ticket', ARMED);
      style.remove();
    };
  }, []);
}
