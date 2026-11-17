// A4 with 12 mm margins while a statement page is open: @page applies to the whole printout and cannot be limited to a
// class, so the rule exists only while the page is open (as the roll's size on the ticket pages). The body class
// scopes the page's other print rules in club.css. Used by the member's and the regular client's statements.
import { useEffect } from 'react';

export function useA4Page() {
  useEffect(() => {
    document.body.classList.add('print-statement');
    const style = document.createElement('style');
    style.textContent = '@page { size: A4; margin: 12mm; }';
    document.head.append(style);
    return () => {
      document.body.classList.remove('print-statement');
      style.remove();
    };
  }, []);
}
