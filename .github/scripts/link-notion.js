const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const REPO_NAME = process.env.REPOSITORY_NAME || "";

const NOTION_URL_PATTERN =
  /https?:\/\/(?:www\.)?notion\.(?:so|site|com)\/(?:[^/\s?#]+\/)?(?:[^/\s?#]+-)?([a-f0-9]{32}|[a-f0-9-]{36})/g;

function extractPageIds(text) {
  const ids = [];
  for (const match of text.matchAll(NOTION_URL_PATTERN)) {
    ids.push(match[1].replace(/-/g, ""));
  }
  return [...new Set(ids)];
}

function resolveStatus() {
  const action = process.env.PR_ACTION || "opened";
  const merged = process.env.PR_MERGED === "true";

  if (action === "closed" && merged) return "Merged";
  if (action === "closed") return "Closed";
  return "Open";
}

// PR 番号は複数のリポで重なり、番号で探すと別リポの PR のページを上書きするため URL で探す
async function findExistingPR(prUrl) {
  const res = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      filter: {
        property: "GitHub URL",
        url: { equals: prUrl },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Notion query failed: ${err.message}`);
  }

  const data = await res.json();
  return data.results[0] || null;
}

async function createPRPage(relatedPageIds) {
  const prNumber = process.env.PR_NUMBER;
  const prTitle = process.env.PR_TITLE;
  const prUrl = process.env.PR_URL;
  const prAuthor = process.env.PR_AUTHOR || "";

  const properties = {
    "PR Title": {
      title: [{ text: { content: prTitle } }],
    },
    "GitHub URL": {
      url: prUrl,
    },
    "PR Number": {
      rich_text: [{ text: { content: String(prNumber) } }],
    },
    Created: {
      date: { start: new Date().toISOString() },
    },
    Status: {
      select: { name: resolveStatus() },
    },
    Author: {
      rich_text: [{ text: { content: prAuthor } }],
    },
  };

  if (REPO_NAME) {
    properties["Repository"] = {
      select: { name: REPO_NAME },
    };
  }

  if (relatedPageIds.length > 0) {
    properties["関連PBL"] = {
      relation: relatedPageIds.map((id) => ({ id })),
    };
  }

  const response = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties,
  });

  console.log(`✅ Created Notion page: ${response.id}`);
  console.log(`   PR #${prNumber}: ${prTitle}`);
  if (relatedPageIds.length > 0) {
    console.log(`   🔗 Linked to ${relatedPageIds.length} PBL page(s)`);
  }
}

async function updatePRPage(pageId, relatedPageIds) {
  const prTitle = process.env.PR_TITLE;
  const prUrl = process.env.PR_URL;
  const prAuthor = process.env.PR_AUTHOR || "";
  const status = resolveStatus();

  const properties = {
    "PR Title": {
      title: [{ text: { content: prTitle } }],
    },
    "GitHub URL": {
      url: prUrl,
    },
    Author: {
      rich_text: [{ text: { content: prAuthor } }],
    },
    Status: {
      select: { name: status },
    },
  };

  // Mergedの場合、マージ日時も更新
  if (status === "Merged") {
    properties["Merged"] = {
      date: { start: new Date().toISOString() },
    };
  }

  if (REPO_NAME) {
    properties["Repository"] = {
      select: { name: REPO_NAME },
    };
  }

  if (relatedPageIds.length > 0) {
    properties["関連PBL"] = {
      relation: relatedPageIds.map((id) => ({ id })),
    };
  }

  await notion.pages.update({
    page_id: pageId,
    properties,
  });

  console.log(`✅ Updated existing Notion page: ${pageId} (Status: ${status})`);
}

async function main() {
  if (!DATABASE_ID) {
    console.error("❌ NOTION_DATABASE_ID is not set.");
    process.exit(1);
  }

  const prNumber = process.env.PR_NUMBER;
  const body = process.env.PR_BODY || "";
  const relatedPageIds = extractPageIds(body);

  if (relatedPageIds.length > 0) {
    console.log(`Found ${relatedPageIds.length} Notion page(s) in PR body.`);
  } else {
    console.log("No Notion links found in PR body.");
  }

  const existing = await findExistingPR(process.env.PR_URL);

  if (existing) {
    console.log(`PR #${prNumber} already exists. Updating...`);
    await updatePRPage(existing.id, relatedPageIds);
  } else {
    console.log(`PR #${prNumber} not found. Creating...`);
    await createPRPage(relatedPageIds);
  }

  console.log("🎉 Done.");
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
