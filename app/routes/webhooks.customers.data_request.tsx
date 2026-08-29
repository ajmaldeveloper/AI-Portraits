import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  // This app never links a customer's Shopify identity (id, email, phone)
  // to the photos or generations it stores — every record is scoped only
  // to `shop`, with no per-customer lookup key anywhere in the schema.
  // There is therefore no data this app can return for the specific
  // customer named in the payload; logged here for the compliance audit
  // trail, per Shopify's mandatory webhook requirements.
  console.log(`Received ${topic} webhook for ${shop}`, payload);

  return new Response();
};
