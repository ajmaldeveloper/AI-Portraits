import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  // Same reasoning as customers/data_request: this app has no field
  // anywhere that links a stored photo/generation to a specific Shopify
  // customer id, email, or phone, so there is nothing here to erase on
  // that customer's behalf. Logged for the compliance audit trail.
  console.log(`Received ${topic} webhook for ${shop}`, payload);

  return new Response();
};
