const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const NOTION_URL_PATTERN =
  /https?:\/\/(?:www\.)?notion\.(?:so|site|com)\/(?:[^/\s?#]+\/)?([a-f0-9]{32}|[a-f0-9-]{36})/g;

function extractPageIds(text) {
  const ids = [];
  for (const match of text.matchAll(NOTION_URL_PATTERN)) {
    ids.push(match[1].replace(/-/g, ""));
  }
  return [...new Set(ids)];
}

async function addCommentToNotion(pageId) {
  const prNumber = process.env.PR_NUMBER;
  const prTitle = process.env.PR_TITLE;
  const prUrl = process.env.PR_URL;

  await notion.comments.create({
    parent: { page_id: pageId },
    rich_text: [
      {
        text: {
          content: `🔗 PR #${prNumber}: ${prTitle}`,
          link: { url: prUrl },
        },
      },
    ],
  });

  console.log(`✅ Commented on Notion page: ${pageId}`);
}

async function main() {
  const body = process.env.PR_BODY || "";
  const pageIds = extractPageIds(body);

  if (pageIds.length === 0) {
    console.log("No Notion links found in PR body. Skipping.");
    return;
  }

  console.log(`Found ${pageIds.length} Notion page(s) in PR body.`);

  const results = await Promise.allSettled(
    pageIds.map((id) => addCommentToNotion(id))
  );

  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    failures.forEach((f) => console.error("❌ Failed:", f.reason?.message));
    process.exit(1);
  }
}

main();
