# Attachments

Code: `apps/api/src/attachments/` (`sniff.ts`, `extract.ts`, `service.ts`), `src/storage/`, `src/routes/uploads.ts`; web: `components/chat/useAttachments.ts`, `Composer.tsx`, `api/uploads.ts`.

## Flow

1. The composer uploads each file as soon as it's added (paperclip, paste, or drop anywhere on the chat): `POST /api/uploads` (multipart, one file, ≤ 20 MB). The response is an `AttachmentDto`.
2. The server checks the bytes against the extension (`sniff`): PNG/JPEG/GIF/WEBP signatures, `%PDF-`, ZIP for docx/xlsx/pptx, and valid UTF-8 without NUL bytes for .txt/.md/.json/.csv. A mismatch returns 415.
3. Text and office files are converted immediately (`extractText`) and stored in `attachments.extracted_text`. Unreadable files return 422; text is capped at 200 000 characters with a truncation note.
4. The bytes go to `Storage` (`LocalDiskStorage` under `STORAGE_DIR`, key `uploads/<userId>/<attachmentId>`), and the row is created with `message_id = null`.
5. `post-message` with `attachmentIds` checks that each file is the user's, unsent, and allowed for the model (images need `supports_images`, PDFs need `supports_documents`). The files are then linked to the user message inside the send transaction. At most 10 files per message; text may be empty when files are attached.
6. The runner builds the parts for every user turn: text files become `[Attached file: name]\n\n<text>`, images become image parts, PDFs become document parts (read from storage and base64-encoded), then the user's text. A files-only message uses "Describe what you want to do with the attached files."

## Extraction (`extract.ts`)

fflate unzips only the needed entries. The filter rejects any entry that declares more than 50 MB, or more than 100 MB in total, before inflating; fflate also never inflates past an entry's declared size. A tiny tokenizer then walks the XML:

- **docx:** `word/document.xml` paragraphs (`w:t`, with `w:tab` → tab and `w:br` → newline); table rows become tab-separated lines.
- **xlsx:** sheets in workbook order (through `workbook.xml.rels`), shared/inline/number/boolean cells, columns placed by cell reference; each sheet starts with `## Sheet: <name>`.
- **pptx:** slides in presentation order (through `presentation.xml.rels`, falling back to file numbers); `## Slide N` then paragraphs.

## Other routes

- `GET /api/uploads/:id/content`: owner only. It serves the stored bytes with `nosniff` and `default-src 'none'; sandbox`; images and PDFs inline, other files as a download.
- `DELETE /api/uploads/:id`: removes an unsent upload (409 once it has been sent).
- The pg-boss `cleanup-uploads` job runs daily at 03:17 and deletes unsent uploads older than 24 h.

## Web

`useAttachments(model, onReject)` checks the extension, size and count on the client (the server re-checks), tracks each file as uploading/ready/error, cancels in-flight uploads on remove and deletes ready ones. The file picker's `accept` list follows the model. User bubbles show image thumbnails and file chips linking to `/content`.
