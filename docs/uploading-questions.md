# Uploading questions

How to get questions into the reviewer, for the people who do it.

The whole idea: **download a sheet, edit it in Excel, upload it back.** You
never start from a blank file, and you never type an ID.

---

## Before you start

You need **one exam category**. That is all.

Sets (Set A, Set B, Set C) are optional and most categories never use them. If
your category is one straight run of questions, ignore sets entirely.

Subjects and topics are a separate thing for reading material. Questions do not
attach to them.

---

## The three steps

The upload page walks you through these in order.

### 1. Where do these questions go?

Pick the category. If it has sets, pick the set too — otherwise the page tells
you the questions go straight into the category.

It then shows you how many questions are already there, so you know what you are
adding to.

### 2. Download the sheet

Press **Excel (.xlsx)** or **CSV**.

What you get is not a blank template — it is **the questions already in that
category**, ready to edit. The Excel version has dropdowns for Type, Difficulty
and Free Sample, and a second tab explaining every column.

If the category is empty, you get two worked example rows to copy the shape of.

### 3. Upload it back

Choose your edited file. You get a **preview first** — how many questions will
be created, how many updated — and nothing is saved until you press **Import**.

---

## Filling in the sheet

| Column | Required? | What to put |
| --- | --- | --- |
| **SKU** | no | **Leave it alone.** Never type one. |
| **No** | no | Item number. Leave blank on a new row. |
| **Question** | **yes** | The question as the student reads it. |
| **A B C D E** | A and B | The choices. Fill from A down, no gaps. |
| **Answer** | **yes** | The letter (`B`), the full choice text, or True/False. |
| **Type** | no | `mcq` or `true-false`. Blank means mcq. |
| **Difficulty** | no | `easy`, `medium`, `hard`. Blank means medium. |
| **Explanation** | no | Shown to the student after they answer. |
| **Image** | no | A link, or the `/api/assets/...` path from a CMS upload. |
| **Free Sample** | no | `yes` lets non-premium students see this one. |

You can add up to 8 choices (F, G, H) if you need them.

The headers are forgiving: capitals, spaces and punctuation do not matter, and
common alternatives work (`Question Text`, `Correct Answer`, `Rationale`,
`Level`). Extra columns of your own are ignored, not rejected. For yes/no
columns, `oo` and `hindi` work as well as `yes` and `no`.

---

## The one rule that matters: the SKU column

**The SKU is what tells the system which question a row is.**

| The row's SKU | What happens on upload |
| --- | --- |
| Filled in (e.g. `Q-000142`) | **Updates** that question |
| Empty | **Creates a new** question |

So:

- **To fix existing questions** — download, edit the text, upload. The SKUs come
  along and each row updates in place.
- **To add new questions** — add fresh rows at the bottom and **leave their SKU
  cells empty**. The system assigns SKUs.

**Do not delete the SKU column, and do not type SKUs by hand.**

⚠️ **The item number (`No`) does not identify a question.** If you type
question numbers into a fresh sheet and upload it expecting updates, you will
get a second copy of every question instead.

> The "How to fill this in" tab inside the downloaded Excel file currently says
> the opposite. It is wrong — this page is right. See
> [remaining-work.md](remaining-work.md).

Reordering rows in the sheet does nothing — questions keep their item numbers.
An import never deletes anything.

---

## What the file can be

- **Excel** (`.xlsx`, `.xlsm`) or **text** (`.csv`, `.tsv`, `.txt`)
- Old `.xls` is refused — open it and re-save as `.xlsx`
- Up to **10 MB** and **2000 questions** per file; split a longer paper

---

## If it will not upload

**One bad row stops the whole file.** Nothing is saved, you fix the row and
upload again. The preview lists what is wrong and on which row.

Common ones, in the words you will see:

| What it says | What it means |
| --- | --- |
| *The file is empty. Download the template and fill it in.* | Wrong file, or everything got deleted. |
| *No Question column found. The first row has to be the template's header row.* | A title row sits above the headers — delete it. |
| *Choice C is filled in but an earlier choice is blank.* | You skipped B. Fill A, B, C in order. |
| *Choices A and C are the same, so the answer would be ambiguous.* | Two identical choices. |
| *A multiple-choice item needs at least 2 choices.* | Only one choice filled in. |
| *A true-false item needs exactly 2 choices.* | Leave the choice columns blank and it fills True/False for you. |
| *Two rows cannot update the same question.* | The same SKU appears twice — you copied a row without clearing its SKU. |

Blank rows are skipped quietly and counted, so trailing empty rows are fine.

---

## Other ways in

**One at a time** — the "Add question" button, or "Add question here" from a
category page. Same rules, same validation.

**From a text appendix** — if you have questions as plain text
(`1. question / a. choice / Answer Key:`), a script converts them to a
spreadsheet:

```bash
pnpm appwrite:sheet:from-appendices -- --source=appendices.txt --format=xlsx
```

It only writes a file — nothing reaches the database until you upload it
normally. Everything comes out as multiple-choice / medium / not-free, so read
it through and fix the difficulty and explanations before uploading.

---

## Images

Upload through the question editor's image button (max 8 MB, images only), or
paste a link into the **Image** column.

What gets stored is a relative `/api/assets/...` path, so images keep working if
the site moves. For them to appear in the phone app,
`EXPO_PUBLIC_CMS_BASE_URL` must be set in the app's build — without it every
image renders blank.

---

## Who can do what

| Role | Questions |
| --- | --- |
| **Encoder** | Create, edit, import. Cannot delete. |
| **Moderator** | Everything an encoder can, plus delete and publish. |
| **Admin / Super Admin** | Everything. |

Students and members have no dashboard access at all.

---

## After uploading

Questions go live with their **category** — there is no per-question publish.

- A category is published by default.
- A **set** is unpublished by default, so a half-finished Set B stays hidden
  until you switch it on.

The question counts on the category update themselves after every upload. Do
not edit them by hand.
