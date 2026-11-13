/**
 * Turns a GitHub webhook payload into the one piece of text AI Authorship Check judges,
 * plus everything needed to react to it.
 */

export type TargetKind = "issue" | "pull_request" | "issue_comment" | "review_comment";

export interface Target {
  kind: TargetKind;
  body: string;
  author: string;
  authorIsBot: boolean;
  /** author_association from the payload, e.g. OWNER, MEMBER, CONTRIBUTOR, NONE */
  association: string;
  /** Issue or PR number. For review comments this is the PR number. */
  number: number;
  /** Comment id, only for issue_comment / review_comment. */
  commentId?: number;
  edited: boolean;
}

interface User {
  login?: string;
  type?: string;
}

interface Authored {
  body?: string | null;
  user?: User | null;
  author_association?: string;
}

interface Payload {
  action?: string;
  changes?: { body?: unknown };
  issue?: Authored & { number: number };
  pull_request?: Authored & { number: number };
  comment?: Authored & { id: number };
}

const SUPPORTED_ACTIONS = new Set(["opened", "created", "edited"]);

export type ExtractResult = { target: Target } | { skip: string };

export function extractTarget(eventName: string, payload: Payload): ExtractResult {
  const action = payload.action ?? "";
  if (!SUPPORTED_ACTIONS.has(action)) {
    return { skip: `unsupported action "${action}" for ${eventName}` };
  }
  const edited = action === "edited";
  if (edited && payload.changes?.body === undefined) {
    return { skip: "edit did not change the body" };
  }

  switch (eventName) {
    case "issues":
      if (!payload.issue) return { skip: "payload has no issue" };
      return { target: build("issue", payload.issue, payload.issue.number, undefined, edited) };

    case "pull_request":
    case "pull_request_target":
      if (!payload.pull_request) return { skip: "payload has no pull_request" };
      return {
        target: build("pull_request", payload.pull_request, payload.pull_request.number, undefined, edited),
      };

    case "issue_comment":
      if (!payload.comment || !payload.issue) return { skip: "payload has no comment" };
      return {
        target: build("issue_comment", payload.comment, payload.issue.number, payload.comment.id, edited),
      };

    case "pull_request_review_comment":
      if (!payload.comment || !payload.pull_request) return { skip: "payload has no review comment" };
      return {
        target: build("review_comment", payload.comment, payload.pull_request.number, payload.comment.id, edited),
      };

    default:
      return { skip: `unsupported event "${eventName}"` };
  }
}

function build(
  kind: TargetKind,
  item: Authored,
  number: number,
  commentId: number | undefined,
  edited: boolean,
): Target {
  const login = item.user?.login ?? "";
  return {
    kind,
    body: item.body ?? "",
    author: login,
    authorIsBot: item.user?.type === "Bot" || login.endsWith("[bot]"),
    association: (item.author_association ?? "NONE").toUpperCase(),
    number,
    commentId,
    edited,
  };
}
