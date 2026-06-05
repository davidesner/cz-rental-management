/**
 * Default electricity compute — no adjustment (assumes solar/other credits are already baked
 * into the invoice total). Override per property if needed.
 */
export interface ElectricityInput {
  periodFrom: string;
  periodTo: string;
  totalCost_haler: number;
}

export interface ElectricityOutput {
  totalAmount_haler: number;
  adjustmentAmount_haler: number;
  adjustmentNote: string | null;
}

export function computeElectricityDefault(input: ElectricityInput): ElectricityOutput {
  return {
    totalAmount_haler: input.totalCost_haler,
    adjustmentAmount_haler: 0,
    adjustmentNote: null,
  };
}
