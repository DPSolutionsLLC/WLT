// Pasted Zoom placeholder links → rows to add to the pool (ITER-053). Pure and browser-safe: the
// paste window calls it for an instant preview, and the server calls it again from scratch before
// adding anything, so the client's preview is never trusted.
//
// One line is one link. Its cells are split on tabs and commas, so a typed
// "Guest 01, guest01@x.com, https://…" and a copy from a spreadsheet both work, in any column
// order: the cell starting https:// is the link, the cell holding an @ is the email, and whatever
// is left is the placeholder's name.

export const MAX_JOIN_LINK_PASTE_CHARACTERS = 200_000;

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_URL_LENGTH = 2000;

// The same shape migration 095's CHECK asks for, so a line the preview accepts is a line the
// database accepts.
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_PATTERN = /^https:\/\/[^\s/?#]+\S*$/;

export type ParsedJoinLink = {
  lineNumber: number;
  placeholderName: string;
  placeholderEmail: string;
  joinUrl: string;
};

export type JoinLinkPasteProblem = { lineNumber: number; message: string };

export type JoinLinkPasteResult = {
  lines: ParsedJoinLink[];
  problems: JoinLinkPasteProblem[];
};

type LineReading = { link: ParsedJoinLink } | { problem: string };

function readLine(text: string, lineNumber: number): LineReading {
  const cells = text
    .split(/[\t,]/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);

  const urlCells = cells.filter((cell) => /^https?:\/\//i.test(cell));
  const emailCells = cells.filter((cell) => cell.includes("@") && !/^https?:\/\//i.test(cell));
  const nameCells = cells.filter((cell) => !urlCells.includes(cell) && !emailCells.includes(cell));

  if (urlCells.length === 0) return { problem: "There is no link starting with https:// on this line." };
  if (urlCells.length > 1) return { problem: "There is more than one link on this line." };
  const [joinUrl] = urlCells;
  if (!joinUrl.toLowerCase().startsWith("https://") || !URL_PATTERN.test(joinUrl)) {
    return { problem: "The link must start with https://." };
  }
  if (joinUrl.length > MAX_URL_LENGTH) {
    return { problem: `The link is too long. Links can be at most ${MAX_URL_LENGTH} characters.` };
  }

  if (emailCells.length === 0) return { problem: "There is no email address on this line." };
  if (emailCells.length > 1) return { problem: "There is more than one email address on this line." };
  const placeholderEmail = emailCells[0].toLowerCase();
  if (!EMAIL_PATTERN.test(placeholderEmail) || placeholderEmail.length > MAX_EMAIL_LENGTH) {
    return { problem: `"${emailCells[0]}" is not a valid email address.` };
  }

  const placeholderName = nameCells.join(" ").replace(/\s+/g, " ").trim();
  if (placeholderName.length === 0) return { problem: "There is no placeholder name on this line." };
  if (placeholderName.length > MAX_NAME_LENGTH) {
    return { problem: `The name is too long. Names can be at most ${MAX_NAME_LENGTH} characters.` };
  }

  return { link: { lineNumber, placeholderName, placeholderEmail, joinUrl } };
}

export function parseJoinLinkPaste(text: string): JoinLinkPasteResult {
  const lines: ParsedJoinLink[] = [];
  const problems: JoinLinkPasteProblem[] = [];
  const firstLineForUrl = new Map<string, number>();
  const firstLineForEmail = new Map<string, number>();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    if (rawLine.trim().length === 0) return;

    const reading = readLine(rawLine, lineNumber);
    if ("problem" in reading) {
      problems.push({ lineNumber, message: reading.problem });
      return;
    }

    const { link } = reading;
    const urlSeenOn = firstLineForUrl.get(link.joinUrl);
    if (urlSeenOn !== undefined) {
      problems.push({ lineNumber, message: `This link is the same as the one on line ${urlSeenOn}.` });
      return;
    }
    const emailSeenOn = firstLineForEmail.get(link.placeholderEmail);
    if (emailSeenOn !== undefined) {
      problems.push({
        lineNumber,
        message: `This email address is the same as the one on line ${emailSeenOn}.`,
      });
      return;
    }

    firstLineForUrl.set(link.joinUrl, lineNumber);
    firstLineForEmail.set(link.placeholderEmail, lineNumber);
    lines.push(link);
  });

  return { lines, problems };
}
