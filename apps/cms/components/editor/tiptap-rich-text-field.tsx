"use client";

import * as React from "react";

import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowRight,
  Bold as BoldIcon,
  Code2,
  FileCode2,
  ImagePlus,
  Italic as ItalicIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Quote,
  Redo2,
  Strikethrough as StrikethroughIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Block styles offered in the toolbar, in the order they are offered. */
const BLOCK_OPTIONS = [
  { value: "paragraph", label: "Body text" },
  { value: "1", label: "Heading 1" },
  { value: "2", label: "Heading 2" },
  { value: "3", label: "Heading 3" },
  { value: "4", label: "Heading 4" },
] as const;

const BLOCK_LABELS: Record<string, string> = Object.fromEntries(
  BLOCK_OPTIONS.map((option) => [option.value, option.label]),
);

/** Which contextual row is open under the toolbar, if any. */
type EditorPanel = "link" | "image" | null;

type ToolbarButtonProps = {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  editorReady: boolean;
  onClick: () => void;
};

/**
 * Icon-only toolbar button; the label lives in the tooltip and the a11y name.
 *
 * Declared at module scope on purpose. A component defined inside the editor's
 * render is a different type on every keystroke, so React would unmount and
 * remount all twenty buttons as someone types - losing keyboard focus each time.
 */
function ToolbarButton({
  icon: Icon,
  label,
  shortcut,
  active = false,
  disabled = false,
  editorReady,
  onClick,
}: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className={cn(
        "rounded-lg text-muted-foreground hover:text-foreground",
        active && "bg-primary/10 text-primary hover:text-primary",
      )}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled || !editorReady}
      onClick={onClick}
    >
      <Icon />
    </Button>
  );
}

function Divider() {
  return (
    <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border/80" />
  );
}

/**
 * Accepts what someone actually pastes.
 *
 * "example.com" is a link to a person and nothing to `new URL`, so a bare
 * domain gets https rather than an error. Anything that is not http, https, or
 * mailto is refused - a javascript: URL in review content is stored XSS.
 */
function normalizeLinkUrl(rawValue: string) {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);

    return ["http:", "https:", "mailto:"].includes(parsed.protocol)
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

type TiptapRichTextFieldProps = {
  id: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  invalid?: boolean;
  ariaDescribedBy?: string;
  onValueChange?: (value: string) => void;
};

type EditorInputContentType = "markdown" | "html";

const BULLET_LINE_PATTERN = /^(\s*)[-*+]\s+/;
const ORDERED_LINE_PATTERN = /^(\s*)\d+\.\s+/;
const LIST_MARKER_PATTERN = /^(?:[-*+]|\d+\.)\s+/;
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
const IMAGE_DELETE_DEBOUNCE_MS = 4000;
const MANAGED_ASSET_PATH_PATTERN = /^\/api\/assets\/([^/]+)$/;

function extractManagedAssetFileId(rawSource: unknown) {
  if (typeof rawSource !== "string") {
    return null;
  }

  const trimmedSource = rawSource.trim();

  if (!trimmedSource) {
    return null;
  }

  const fallbackOrigin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";

  try {
    const parsedSourceUrl = new URL(trimmedSource, fallbackOrigin);
    const matchedPath = MANAGED_ASSET_PATH_PATTERN.exec(
      parsedSourceUrl.pathname,
    );

    if (!matchedPath?.[1]) {
      return null;
    }

    return decodeURIComponent(matchedPath[1]);
  } catch {
    return null;
  }
}

function collectManagedAssetFileIds(value: unknown, target: Set<string>) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectManagedAssetFileIds(item, target);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const node = value as {
    type?: unknown;
    attrs?: { src?: unknown };
    content?: unknown;
  };

  if (node.type === "image") {
    const managedFileId = extractManagedAssetFileId(node.attrs?.src);

    if (managedFileId) {
      target.add(managedFileId);
    }
  }

  if (node.content) {
    collectManagedAssetFileIds(node.content, target);
  }
}

function shouldNormalizePastedText(rawText: string, rawHtml: string) {
  const trimmedText = rawText.trim();

  if (!trimmedText) {
    return false;
  }

  const hasListSignal =
    /^[ \t]*[\u2022\u25E6\u25AA\u25CF\u25CB\u25C6\u25A0]\s+/m.test(
      trimmedText,
    ) ||
    /^[ \t]*(?:[-*+]|\d+[.)])\s+/m.test(trimmedText) ||
    /^[ \t]*(?:[-*+]|\d+[.)])\s*$/m.test(trimmedText);
  const hasMarkdownSignal =
    /^[ \t]*#{1,6}\s+/m.test(trimmedText) ||
    /^[ \t]*>\s+/m.test(trimmedText) ||
    /```|`[^`\n]+`/.test(trimmedText);

  return !rawHtml || hasListSignal || hasMarkdownSignal;
}

function normalizePastedMarkdown(rawText: string) {
  let normalizedText = rawText
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .trimEnd();

  const lines = normalizedText.split("\n");
  const mergedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].replace(/\t/g, "  ");

    line = line
      .replace(/^(\s*)[\u2022\u25E6\u25AA\u25CF\u25CB\u25C6\u25A0]\s+/, "$1- ")
      .replace(/^(\s*)(\d+)\)\s+/, "$1$2. ");

    if (/^(\s*)(?:[-*+]|\d+\.)\s*$/.test(line)) {
      let lookaheadIndex = index + 1;

      while (lookaheadIndex < lines.length && !lines[lookaheadIndex].trim()) {
        lookaheadIndex += 1;
      }

      const nextLine = lines[lookaheadIndex];
      const nextLineTrimmed = nextLine?.trim() ?? "";

      if (nextLineTrimmed && !LIST_MARKER_PATTERN.test(nextLineTrimmed)) {
        const indent = line.match(/^(\s*)/)?.[1] ?? "";
        const marker = line.trim();
        line = `${indent}${marker} ${nextLineTrimmed}`;
        index = lookaheadIndex;
      }
    }

    mergedLines.push(line);
  }

  normalizedText = mergedLines.join("\n");

  normalizedText = normalizedText.replace(
    /(^\s*(?:[-*+]|\d+\.)\s+.+\n)\s*\n(?=\s*(?:[-*+]|\d+\.)\s+)/gm,
    "$1",
  );

  const nestedListLines: string[] = [];
  let orderedIndent: number | null = null;

  for (const rawLine of normalizedText.split("\n")) {
    const line = rawLine;

    if (ORDERED_LINE_PATTERN.test(line)) {
      orderedIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
      nestedListLines.push(line);
      continue;
    }

    if (!line.trim()) {
      nestedListLines.push(line);
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE_PATTERN);

    if (
      bulletMatch &&
      orderedIndent !== null &&
      bulletMatch[1].length <= orderedIndent
    ) {
      nestedListLines.push(
        `${" ".repeat(orderedIndent + 2)}${line.trimStart()}`,
      );
      continue;
    }

    const currentIndent = line.match(/^(\s*)/)?.[1].length ?? 0;

    if (orderedIndent !== null && currentIndent <= orderedIndent) {
      orderedIndent = null;
    }

    nestedListLines.push(line);
  }

  normalizedText = nestedListLines.join("\n").replace(/\n{3,}/g, "\n\n");

  return normalizedText.trim();
}

function serializeEditorValue(editor: Editor) {
  if (editor.isEmpty) {
    return "";
  }

  const markdownValue = editor.getMarkdown();
  return markdownValue.trim() ? markdownValue : "";
}

function resolveEditorContentType(value: string): EditorInputContentType {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "markdown";
  }

  return /<\/?[a-z][\w:-]*(\s[^>]*)?>/i.test(trimmedValue)
    ? "html"
    : "markdown";
}

function normalizeImageUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return parsedUrl.toString();
    }
  } catch {
    return null;
  }

  return null;
}

export function TiptapRichTextField({
  id,
  name,
  defaultValue = "",
  placeholder = "Write your content...",
  invalid = false,
  ariaDescribedBy,
  onValueChange,
}: TiptapRichTextFieldProps) {
  const contentType = React.useMemo<EditorInputContentType>(
    () => resolveEditorContentType(defaultValue),
    [defaultValue],
  );
  const initialSerializedValue = contentType === "markdown" ? defaultValue : "";
  const [serializedValue, setSerializedValue] = React.useState(
    initialSerializedValue,
  );
  const [imageUrl, setImageUrl] = React.useState("");
  const [linkUrl, setLinkUrl] = React.useState("");
  const [panel, setPanel] = React.useState<EditorPanel>(null);
  const [imageError, setImageError] = React.useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = React.useState(false);
  const onValueChangeRef = React.useRef(onValueChange);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const managedAssetFileIdsRef = React.useRef<Set<string>>(new Set());
  const pendingAssetDeletesRef = React.useRef<Map<string, number>>(new Map());

  React.useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  React.useEffect(() => {
    setSerializedValue(initialSerializedValue);
  }, [initialSerializedValue]);

  const syncSerializedValue = React.useCallback((editor: Editor) => {
    const nextValue = serializeEditorValue(editor);
    setSerializedValue(nextValue);
    onValueChangeRef.current?.(nextValue);
  }, []);

  const deleteManagedAssetFromStorage = React.useCallback(
    async (fileId: string) => {
      try {
        const deleteResponse = await fetch(
          `/api/assets/${encodeURIComponent(fileId)}`,
          {
            method: "DELETE",
          },
        );

        if (deleteResponse.ok || deleteResponse.status === 404) {
          return;
        }

        const payload = (await deleteResponse.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(payload?.error || "Failed to delete removed image.");
      } catch (error) {
        setImageError(
          error instanceof Error
            ? error.message
            : "Failed to delete removed image from storage.",
        );
      }
    },
    [],
  );

  const cancelPendingAssetDelete = React.useCallback((fileId: string) => {
    const pendingTimeoutId = pendingAssetDeletesRef.current.get(fileId);

    if (pendingTimeoutId === undefined) {
      return;
    }

    window.clearTimeout(pendingTimeoutId);
    pendingAssetDeletesRef.current.delete(fileId);
  }, []);

  const scheduleManagedAssetDelete = React.useCallback(
    (fileId: string) => {
      if (pendingAssetDeletesRef.current.has(fileId)) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        pendingAssetDeletesRef.current.delete(fileId);
        void deleteManagedAssetFromStorage(fileId);
      }, IMAGE_DELETE_DEBOUNCE_MS);

      pendingAssetDeletesRef.current.set(fileId, timeoutId);
    },
    [deleteManagedAssetFromStorage],
  );

  const syncManagedAssetLifecycle = React.useCallback(
    (editor: Editor) => {
      const nextAssetFileIds = new Set<string>();
      collectManagedAssetFileIds(editor.getJSON(), nextAssetFileIds);

      for (const assetFileId of nextAssetFileIds) {
        cancelPendingAssetDelete(assetFileId);
      }

      for (const previousAssetFileId of managedAssetFileIdsRef.current) {
        if (!nextAssetFileIds.has(previousAssetFileId)) {
          scheduleManagedAssetDelete(previousAssetFileId);
        }
      }

      managedAssetFileIdsRef.current = nextAssetFileIds;
    },
    [cancelPendingAssetDelete, scheduleManagedAssetDelete],
  );

  React.useEffect(
    () => () => {
      for (const timeoutId of pendingAssetDeletesRef.current.values()) {
        window.clearTimeout(timeoutId);
      }

      pendingAssetDeletesRef.current.clear();
    },
    [],
  );

  const editor = useEditor({
    immediatelyRender: false,
    content: defaultValue,
    contentType,
    extensions: [
      // StarterKit already ships Underline and Link; adding either separately
      // registers it twice and Tiptap warns about the duplicate.
      StarterKit.configure({
        bulletList: { keepMarks: true, keepAttributes: false },
        orderedList: { keepMarks: true, keepAttributes: false },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["http", "https", "mailto"],
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        },
      }),
      Markdown,
      // Curly quotes, proper dashes and ellipses as you type. Reviewer notes
      // are prose, and prose typed with straight quotes reads like a form.
      Typography,
      Image.configure({ allowBase64: false }),
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: {
        id,
        class:
          "tiptap-content min-h-72 resize-y overflow-y-auto px-4 py-3 text-sm leading-7 outline-none sm:min-h-96",
        "aria-invalid": invalid ? "true" : "false",
        ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
      },
    },
    onCreate: ({ editor }) => {
      syncSerializedValue(editor);
      syncManagedAssetLifecycle(editor);
    },
    onUpdate: ({ editor }) => {
      syncSerializedValue(editor);
      syncManagedAssetLifecycle(editor);
    },
  });

  const handleInsertImage = React.useCallback(() => {
    if (!editor) {
      return;
    }

    const normalizedUrl = normalizeImageUrl(imageUrl);

    if (!normalizedUrl) {
      setImageError("Please enter a valid http or https image URL.");
      return;
    }

    editor.chain().focus().setImage({ src: normalizedUrl }).run();
    setImageUrl("");
    setImageError(null);
  }, [editor, imageUrl]);

  const handleDeleteSelectedImage = React.useCallback(() => {
    if (!editor || !editor.isActive("image")) {
      return;
    }

    editor.chain().focus().deleteSelection().run();
  }, [editor]);

  const handleImageFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!editor) {
        return;
      }

      const selectedFile = event.target.files?.[0];

      if (!selectedFile) {
        return;
      }

      if (!selectedFile.type.startsWith("image/")) {
        setImageError("Only image files are allowed.");
        event.target.value = "";
        return;
      }

      if (selectedFile.size > MAX_IMAGE_UPLOAD_BYTES) {
        setImageError("Image is too large. Maximum size is 8 MB.");
        event.target.value = "";
        return;
      }

      try {
        setIsUploadingImage(true);
        setImageError(null);

        const uploadData = new FormData();
        uploadData.set("file", selectedFile);

        const uploadResponse = await fetch("/api/assets/upload", {
          method: "POST",
          body: uploadData,
        });

        const uploadPayload = (await uploadResponse
          .json()
          .catch(() => null)) as {
          url?: string;
          path?: string;
          error?: string;
        } | null;

        if (!uploadResponse.ok) {
          throw new Error(uploadPayload?.error || "Failed to upload image.");
        }

        const uploadedImageUrl = uploadPayload?.url ?? uploadPayload?.path;

        if (!uploadedImageUrl) {
          throw new Error("Upload succeeded but no image URL was returned.");
        }

        const normalizedUploadedImageUrl = uploadedImageUrl.startsWith("/")
          ? new URL(uploadedImageUrl, window.location.origin).toString()
          : uploadedImageUrl;

        editor
          .chain()
          .focus()
          .setImage({ src: normalizedUploadedImageUrl, alt: selectedFile.name })
          .run();
      } catch (error) {
        setImageError(
          error instanceof Error
            ? error.message
            : "Unable to upload image right now.",
        );
      } finally {
        setIsUploadingImage(false);
        event.target.value = "";
      }
    },
    [editor],
  );

  const handleEditorPaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (!editor) {
        return;
      }

      const rawText = event.clipboardData.getData("text/plain");
      const rawHtml = event.clipboardData.getData("text/html");

      if (!shouldNormalizePastedText(rawText, rawHtml)) {
        return;
      }

      const normalizedText = normalizePastedMarkdown(rawText);

      if (!normalizedText) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      editor
        .chain()
        .focus()
        .insertContent(normalizedText, { contentType: "markdown" })
        .run();
    },
    [editor],
  );

  const canUndo = Boolean(editor?.can().chain().focus().undo().run());
  const canRedo = Boolean(editor?.can().chain().focus().redo().run());
  const canIndentListItem = Boolean(
    editor?.can().chain().focus().sinkListItem("listItem").run(),
  );
  const canOutdentListItem = Boolean(
    editor?.can().chain().focus().liftListItem("listItem").run(),
  );

  const isLinkActive = Boolean(editor?.isActive("link"));

  const openLinkPanel = React.useCallback(() => {
    if (!editor) {
      return;
    }

    // Prefilled with the link already under the cursor, so the button edits
    // rather than silently replacing.
    setLinkUrl(String(editor.getAttributes("link").href ?? ""));
    setPanel((current) => (current === "link" ? null : "link"));
  }, [editor]);

  const handleApplyLink = React.useCallback(() => {
    if (!editor) {
      return;
    }

    const trimmed = linkUrl.trim();

    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setPanel(null);
      return;
    }

    const normalized = normalizeLinkUrl(trimmed);

    if (!normalized) {
      setImageError("Enter a valid http, https, or mailto link.");
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: normalized })
      .run();
    setLinkUrl("");
    setImageError(null);
    setPanel(null);
  }, [editor, linkUrl]);

  const handleRemoveLink = React.useCallback(() => {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkUrl("");
    setPanel(null);
  }, [editor]);

  const activeBlock = editor?.isActive("heading", { level: 1 })
    ? "1"
    : editor?.isActive("heading", { level: 2 })
      ? "2"
      : editor?.isActive("heading", { level: 3 })
        ? "3"
        : editor?.isActive("heading", { level: 4 })
          ? "4"
          : "paragraph";

  const applyBlock = React.useCallback(
    (value: string) => {
      if (!editor) {
        return;
      }

      if (value === "paragraph") {
        editor.chain().focus().setParagraph().run();
        return;
      }

      const level = Number(value) as 1 | 2 | 3 | 4;
      editor.chain().focus().toggleHeading({ level }).run();
    },
    [editor],
  );

  const plainText = editor?.getText().trim() ?? "";
  const wordCount = plainText ? plainText.split(/\s+/).length : 0;

  const Tool = (props: Omit<ToolbarButtonProps, "editorReady">) => (
    <ToolbarButton {...props} editorReady={Boolean(editor)} />
  );

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={serializedValue} readOnly />

      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-background/70 shadow-xs transition-colors focus-within:ring-[3px]",
          invalid
            ? "border-destructive/60 focus-within:ring-destructive/25"
            : "border-border/70 focus-within:ring-ring/35",
        )}
      >
        {/* Sticky, so the controls stay reachable in a long note - which is
            what most review material is. */}
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 border-b border-border/70 bg-card/95 px-2 py-1.5 backdrop-blur">
          <Tool
            icon={Undo2}
            label="Undo"
            shortcut="Ctrl+Z"
            disabled={!canUndo}
            onClick={() => editor?.chain().focus().undo().run()}
          />
          <Tool
            icon={Redo2}
            label="Redo"
            shortcut="Ctrl+Shift+Z"
            disabled={!canRedo}
            onClick={() => editor?.chain().focus().redo().run()}
          />

          <Divider />

          {/* One dropdown instead of five buttons that were mostly off. */}
          <Select
            value={activeBlock}
            onValueChange={(value) => applyBlock(String(value ?? "paragraph"))}
          >
            <SelectTrigger
              aria-label="Text style"
              className="h-8 w-36 rounded-lg border-0 bg-transparent px-2 text-xs shadow-none hover:bg-muted"
            >
              {BLOCK_LABELS[activeBlock] ?? "Body text"}
            </SelectTrigger>
            <SelectContent>
              {BLOCK_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Divider />

          <Tool
            icon={BoldIcon}
            label="Bold"
            shortcut="Ctrl+B"
            active={Boolean(editor?.isActive("bold"))}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          />
          <Tool
            icon={ItalicIcon}
            label="Italic"
            shortcut="Ctrl+I"
            active={Boolean(editor?.isActive("italic"))}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          />
          <Tool
            icon={UnderlineIcon}
            label="Underline"
            shortcut="Ctrl+U"
            active={Boolean(editor?.isActive("underline"))}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          />
          <Tool
            icon={StrikethroughIcon}
            label="Strikethrough"
            active={Boolean(editor?.isActive("strike"))}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          />
          <Tool
            icon={Code2}
            label="Inline code"
            active={Boolean(editor?.isActive("code"))}
            onClick={() => editor?.chain().focus().toggleCode().run()}
          />

          <Divider />

          <Tool
            icon={List}
            label="Bullet list"
            active={Boolean(editor?.isActive("bulletList"))}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
          <Tool
            icon={ListOrdered}
            label="Numbered list"
            active={Boolean(editor?.isActive("orderedList"))}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          />
          <Tool
            icon={ArrowLeft}
            label="Outdent"
            shortcut="Shift+Tab"
            disabled={!canOutdentListItem}
            onClick={() =>
              editor?.chain().focus().liftListItem("listItem").run()
            }
          />
          <Tool
            icon={ArrowRight}
            label="Indent"
            shortcut="Tab"
            disabled={!canIndentListItem}
            onClick={() =>
              editor?.chain().focus().sinkListItem("listItem").run()
            }
          />

          <Divider />

          <Tool
            icon={LinkIcon}
            label={isLinkActive ? "Edit link" : "Add link"}
            active={isLinkActive || panel === "link"}
            onClick={openLinkPanel}
          />
          <Tool
            icon={ImagePlus}
            label="Insert image"
            active={panel === "image"}
            onClick={() =>
              setPanel((current) => (current === "image" ? null : "image"))
            }
          />
          <Tool
            icon={Quote}
            label="Quote"
            active={Boolean(editor?.isActive("blockquote"))}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          />
          <Tool
            icon={FileCode2}
            label="Code block"
            active={Boolean(editor?.isActive("codeBlock"))}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          />
          <Tool
            icon={Minus}
            label="Divider"
            onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          />

          <span className="ml-auto pr-1 text-[11px] tabular-nums text-muted-foreground">
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </span>
        </div>

        {/* One contextual row, shown only for the tool that needs it, instead
            of a permanent bank of image controls above every editor. */}
        {panel === "link" ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/30 px-3 py-2">
            <Input
              autoFocus
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleApplyLink();
                }

                if (event.key === "Escape") {
                  setPanel(null);
                }
              }}
              placeholder="https://example.com"
              className="h-8 flex-1 sm:max-w-sm"
            />
            <Button
              type="button"
              size="sm"
              className="rounded-full"
              onClick={handleApplyLink}
            >
              {isLinkActive ? "Update link" : "Add link"}
            </Button>
            {isLinkActive ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-full"
                onClick={handleRemoveLink}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}

        {panel === "image" ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-muted/30 px-3 py-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageFileChange}
            />

            <Input
              id={`${id}-image-url`}
              value={imageUrl}
              onChange={(event) => {
                setImageUrl(event.target.value);
                if (imageError) {
                  setImageError(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleInsertImage();
                }
              }}
              placeholder="Paste an image link"
              className="h-8 flex-1 sm:max-w-sm"
              disabled={isUploadingImage}
            />

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={handleInsertImage}
              disabled={!editor || isUploadingImage}
            >
              Insert
            </Button>

            <Button
              type="button"
              size="sm"
              className="rounded-full"
              onClick={() => fileInputRef.current?.click()}
              disabled={!editor || isUploadingImage}
            >
              {isUploadingImage ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              Upload
            </Button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={handleDeleteSelectedImage}
              disabled={!editor || !editor.isActive("image") || isUploadingImage}
            >
              <Trash2 data-icon="inline-start" />
              Remove selected
            </Button>
          </div>
        ) : null}

        <EditorContent editor={editor} onPaste={handleEditorPaste} />
      </div>

      {imageError ? (
        <p className="text-xs text-destructive">{imageError}</p>
      ) : null}
    </div>
  );
}
