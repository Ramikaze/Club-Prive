// A number field of a settings form: left empty, the setting keeps its value (the key is left out of the change, as
// JSON drops an undefined value); otherwise the number typed, which the server checks (NaN is refused there).
export const typedNumber = (text) => (String(text ?? '').trim() === '' ? undefined : Number(text));
