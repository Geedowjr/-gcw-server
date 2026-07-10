import Stripe from "stripe";
import { env } from "../env.js";

export const stripe = new Stripe(env.STRIPE_SECRET_KEY || "sk_test_placeholder", { apiVersion: "2024-04-10" });
