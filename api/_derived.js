const stableHash = value => {
  let n = 2166136261;
  for (const character of String(value)) n = Math.imul(n ^ character.charCodeAt(0), 16777619);
  return n >>> 0;
};

export function createDerivedFeature(left, right, leftLabel, rightLabel) {
  const ordered = [{ id: left, label: leftLabel }, { id: right, label: rightLabel }].sort((a, b) => a.id.localeCompare(b.id));
  const [first, second] = ordered;
  return {
    id: `drv_${stableHash(`product:${first.id}:${second.id}`).toString(36)}`,
    label: `${first.label} × ${second.label}`,
    family: "derived",
    operation: "product",
    left: first.id,
    right: second.id,
    formula: `${first.label} × ${second.label}`
  };
}

export function derivedValue(row, definition) {
  const left = Number(row?.[definition.left]), right = Number(row?.[definition.right]);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  if (definition.operation === "product") return left * right;
  return null;
}

export function materializeDerivedRows(rows, definitions = []) {
  if (!definitions.length) return rows.map(row => ({ ...row }));
  return rows.map(row => {
    const copy = { ...row };
    for (const definition of definitions) copy[definition.id] = derivedValue(row, definition);
    return copy;
  });
}
