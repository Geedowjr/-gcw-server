import { stripeGateway } from "./stripe.js";
import { mpesaGateway } from "./mpesa.js";
import { evcPlusGateway } from "./evcplus.js";
import { eDahabGateway } from "./edahab.js";
import type { PaymentGateway } from "./types.js";

export const gateways: Record<string, PaymentGateway> = {
  stripe: stripeGateway,
  mpesa: mpesaGateway,
  evcplus: evcPlusGateway,
  edahab: eDahabGateway,
};

export function getGateway(method: string): PaymentGateway {
  const gateway = gateways[method];
  if (!gateway) throw new Error(`unknown_payment_method:${method}`);
  return gateway;
}

export * from "./types.js";
