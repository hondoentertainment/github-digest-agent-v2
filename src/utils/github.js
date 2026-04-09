import { Octokit } from "octokit";
import { withRetry } from "./retry.js";
import dotenv from "dotenv";
dotenv.config();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function getAllRepos() {
  return withRetry(async () => {
    const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
      sort: "updated",
      per_page: 100,
      affiliation: "owner,collaborator,organization_member",
    });

    const excluded = (process.env.EXCLUDE_REPOS || "")
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);

    return repos.filter((r) => !r.archived && !excluded.includes(r.full_name.toLowerCase()));
  });
}

export { octokit };
