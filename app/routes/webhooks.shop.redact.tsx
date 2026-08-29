import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Sent 48 hours after uninstall — the real erasure point for this
  // shop's data (app/uninstalled only clears the session, giving a
  // grace period in case of reinstall). Deleting Style cascades to its
  // StyleField, StyleAsset, and Generation rows (see prisma/schema.prisma
  // onDelete: Cascade), so this clears every customer photo and
  // generated result stored for this shop along with it.
  await db.style.deleteMany({ where: { shop } });

  await db.shopAIProviderSettings.deleteMany({ where: { shop } });
  await db.shopGenerationDefaults.deleteMany({ where: { shop } });
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
