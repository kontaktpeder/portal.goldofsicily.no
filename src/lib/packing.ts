export type PackingConfig = {
  unitsPerPackage: number;
  packagesPerCarton: number;
};

export type PlannedPackage = {
  seq: number;
  shortCode: string;
  code: string;
  quantity: number;
};

export type PlannedCarton = {
  seq: number;
  shortCode: string;
  code: string;
  packageSeqs: number[];
  quantity: number;
};

export type PackingPlan = {
  packages: PlannedPackage[];
  cartons: PlannedCarton[];
  fullPackages: number;
  remainderQuantity: number;
};

export function padUnitSeq(seq: number): string {
  const n = Math.trunc(seq);
  if (!Number.isFinite(n) || n < 1) throw new Error("sequence must be >= 1");
  return String(n).padStart(3, "0");
}

export function shortPackageCode(seq: number): string {
  return `P${padUnitSeq(seq)}`;
}

export function shortCartonCode(seq: number): string {
  return `C${padUnitSeq(seq)}`;
}

/** Physical bag under a LOT. Never a parallel identifier. */
export function formatPackageCode(lotCode: string, seq: number): string {
  return `${lotCode}-${shortPackageCode(seq)}`;
}

/** Physical carton under a LOT. Never a parallel identifier. */
export function formatCartonCode(lotCode: string, seq: number): string {
  return `${lotCode}-${shortCartonCode(seq)}`;
}

export function derivedCartonCount(cartons: readonly { seq: number }[]): number {
  return cartons.length;
}

export function cartonInsertRows(lotId: string, plan: PackingPlan) {
  return plan.cartons.map((carton) => ({
    gold_lot_id: lotId,
    carton_seq: carton.seq,
    carton_code: carton.code,
  }));
}

export function packageInsertRows(
  lotId: string,
  plan: PackingPlan,
  cartonIdBySeq: ReadonlyMap<number, string>,
) {
  const cartonSeqByPackage = new Map<number, number>();
  for (const carton of plan.cartons) {
    for (const seq of carton.packageSeqs) cartonSeqByPackage.set(seq, carton.seq);
  }
  return plan.packages.map((pack) => ({
    gold_lot_id: lotId,
    carton_id: cartonIdBySeq.get(cartonSeqByPackage.get(pack.seq) ?? 0) ?? null,
    package_seq: pack.seq,
    package_code: pack.code,
    quantity: pack.quantity,
  }));
}

export function packingPlanFromStored(input: {
  packages: Array<{
    package_seq: number;
    package_code: string;
    quantity: number;
    carton_id: string | null;
  }>;
  cartons: Array<{
    id: string;
    carton_seq: number;
    carton_code: string;
  }>;
}): PackingPlan {
  const packages: PlannedPackage[] = [...input.packages]
    .sort((a, b) => a.package_seq - b.package_seq)
    .map((pack) => ({
      seq: pack.package_seq,
      shortCode: shortPackageCode(pack.package_seq),
      code: pack.package_code,
      quantity: pack.quantity,
    }));
  const cartons: PlannedCarton[] = [...input.cartons]
    .sort((a, b) => a.carton_seq - b.carton_seq)
    .map((carton) => {
      const bags = input.packages
        .filter((pack) => pack.carton_id === carton.id)
        .sort((a, b) => a.package_seq - b.package_seq);
      return {
        seq: carton.carton_seq,
        shortCode: shortCartonCode(carton.carton_seq),
        code: carton.carton_code,
        packageSeqs: bags.map((pack) => pack.package_seq),
        quantity: bags.reduce((sum, pack) => sum + pack.quantity, 0),
      };
    });
  const typical = Math.max(0, ...packages.map((pack) => pack.quantity));
  const remainder = packages.find((pack) => pack.quantity < typical);
  return {
    packages,
    cartons,
    fullPackages: packages.filter((pack) => pack.quantity === typical).length,
    remainderQuantity: remainder?.quantity ?? 0,
  };
}

export function planPacking(input: {
  lotCode: string;
  approvedQty: number;
  unitsPerPackage: number;
  packagesPerCarton: number;
}): PackingPlan {
  const lotCode = input.lotCode.trim().toUpperCase();
  if (!lotCode) throw new Error("lot code required");
  const approved = Math.trunc(input.approvedQty);
  const units = Math.trunc(input.unitsPerPackage);
  const perCarton = Math.trunc(input.packagesPerCarton);
  if (!Number.isFinite(approved) || approved <= 0) throw new Error("approved quantity must be >= 1");
  if (!Number.isFinite(units) || units <= 0) throw new Error("units per package must be >= 1");
  if (!Number.isFinite(perCarton) || perCarton <= 0) throw new Error("packages per carton must be >= 1");

  const fullPackages = Math.floor(approved / units);
  const remainderQuantity = approved % units;
  const packages: PlannedPackage[] = [];
  for (let seq = 1; seq <= fullPackages; seq += 1) {
    packages.push({
      seq,
      shortCode: shortPackageCode(seq),
      code: formatPackageCode(lotCode, seq),
      quantity: units,
    });
  }
  if (remainderQuantity > 0) {
    const seq = packages.length + 1;
    packages.push({
      seq,
      shortCode: shortPackageCode(seq),
      code: formatPackageCode(lotCode, seq),
      quantity: remainderQuantity,
    });
  }

  const cartons: PlannedCarton[] = [];
  for (let index = 0; index < packages.length; index += perCarton) {
    const slice = packages.slice(index, index + perCarton);
    const seq = cartons.length + 1;
    cartons.push({
      seq,
      shortCode: shortCartonCode(seq),
      code: formatCartonCode(lotCode, seq),
      packageSeqs: slice.map((row) => row.seq),
      quantity: slice.reduce((sum, row) => sum + row.quantity, 0),
    });
  }

  return { packages, cartons, fullPackages, remainderQuantity };
}

export function addCalendarDays(isoDate: string, days: number): string {
  const day = isoDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("date must be YYYY-MM-DD");
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function netWeightGrams(unitWeightG: number | null | undefined, quantity: number): number | null {
  if (unitWeightG == null || unitWeightG <= 0) return null;
  return unitWeightG * quantity;
}

export function formatNetWeight(grams: number | null, decimal: "," | "." = ","): string | null {
  if (grams == null) return null;
  if (grams >= 1000) {
    const kg = grams / 1000;
    const text = Number.isInteger(kg) ? String(kg) : kg.toFixed(2).replace(/\.?0+$/, "");
    return `${text.replace(".", decimal)} kg`;
  }
  return `${grams} g`;
}
