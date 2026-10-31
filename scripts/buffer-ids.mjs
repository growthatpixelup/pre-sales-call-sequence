// Prints your Buffer organization id(s) and each channel's id, name and service, to fill in
// BUFFER_ORG_ID and BUFFER_LINKEDIN_CHANNEL_IDS.
// Usage: BUFFER_API_KEY=... node scripts/buffer-ids.mjs
//   (or: node --env-file=.env.local scripts/buffer-ids.mjs)
// Uses 1 + (number of organizations) Buffer API requests.

const apiKey = process.env.BUFFER_API_KEY;
if (!apiKey) {
  console.error("Set BUFFER_API_KEY first.");
  process.exit(1);
}

async function gql(query) {
  const res = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query }),
  });
  if (res.status === 429) {
    console.error(`Rate limited by Buffer. Retry after ${res.headers.get("retry-after") ?? "?"}s.`);
    process.exit(1);
  }
  const json = await res.json();
  // Buffer returns 200 even for failed queries.
  if (json.errors?.length) {
    console.error("Buffer API errors:", json.errors.map((e) => e.message).join("; "));
    process.exit(1);
  }
  return json.data;
}

const { account } = await gql("query { account { organizations { id name } } }");

for (const org of account.organizations) {
  console.log(`\nOrganization: ${org.name}\n  BUFFER_ORG_ID=${org.id}\n`);
  const { channels } = await gql(
    `query { channels(input: { organizationId: ${JSON.stringify(org.id)} }) { id name displayName service } }`,
  );
  console.table(channels.map((c) => ({ id: c.id, name: c.displayName || c.name, service: c.service })));
  const linkedin = channels.filter((c) => String(c.service).toLowerCase() === "linkedin").map((c) => c.id);
  if (linkedin.length) console.log(`  BUFFER_LINKEDIN_CHANNEL_IDS=${linkedin.join(",")}`);
}
