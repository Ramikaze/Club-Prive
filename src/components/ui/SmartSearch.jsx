// Search box with a list of suggestions under it, from two characters typed (shared/search.js). Arrows move through the
// suggestions, Enter opens the one highlighted, Escape closes the list. The page filters its own list with the same
// text; the suggestions only give a quick way to the item.
import { useId, useState } from 'react';
import Icon from './Icon.jsx';
import { searchable } from '../../../shared/search.js';

export default function SmartSearch({ value, onChange, suggestions, renderSuggestion, onPick, placeholder, label, max = 8 }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = searchable(value) ? suggestions.slice(0, max) : [];
  const expanded = open && shown.length > 0;
  const at = Math.min(active, shown.length - 1);

  const pick = (item) => {
    setOpen(false);
    onPick(item);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (expanded) e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!shown.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => (Math.min(i, shown.length - 1) + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
    } else if (e.key === 'Enter' && expanded) {
      e.preventDefault();
      pick(shown[at]);
    }
  };

  return (
    <div className="search smart-search">
      <Icon name="search" />
      <input
        type="search" value={value} placeholder={placeholder} aria-label={label} autoComplete="off"
        role="combobox" aria-expanded={expanded} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listId}-${at}` : undefined}
        onChange={(e) => { onChange(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {expanded && (
        <ul className="smart-search-list" id={listId} role="listbox" aria-label="Suggestions">
          {shown.map((item, i) => (
            <li
              key={item.id} id={`${listId}-${i}`} role="option" aria-selected={i === at}
              className={i === at ? 'is-active' : undefined}
              // mousedown, not click: the box would lose focus and close the list before the click lands.
              onMouseDown={(e) => { e.preventDefault(); pick(item); }}
              onMouseEnter={() => setActive(i)}
            >
              {renderSuggestion(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
