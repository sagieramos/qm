# Agent Guide

## Project overview

This project is a local first business document builder for IMC Technology. It is intended for a small business operator who prepares, saves, converts, prints, and backs up customer and supplier documents. The application has a dashboard, an all-documents list, a customer directory, a company profile, data and backup settings, and a document editor with a live printable preview. Data remains in IndexedDB on the current device.

## Technology and commands

- HTML5 (`index.html`), CSS (`styles.css`), and vanilla JavaScript (`app.js`, `db.js`).
- IndexedDB is the primary persistence layer. A small legacy migration reads a prior `localStorage` draft.
- No third party libraries, package manager, build step, backend, or automated test suite is present.
- Start the development server with `python3 -m http.server 8000 --bind 0.0.0.0`, then open `http://localhost:8000`. This server is for development and is not production hosting.
- Changes should be checked in a browser when a verification run is requested. Do not claim browser testing if it was not performed.

## Project structure

| File | Purpose |
| --- | --- |
| `index.html` | Application navigation, dashboard and list views, company profile and backup settings, editor form, conversion/history areas, and printable document preview. |
| `styles.css` | Application navigation, responsive workspace and document styles, focus states, and print stylesheet. |
| `app.js` | View rendering, form state, calculations, preview, serialized autosave, document workflows, and backup import/export. |
| `db.js` | IndexedDB schema, persistence operations, migration, and backup serialization. |
| `AGENT.md` | Original user-authored project brief and requirements. |
| `AGENTS.md` | Persistent development and architecture guide for coding agents. |

## Application architecture

The HTML exposes form elements and calls named functions in `app.js`. The JavaScript owns the current editor state, renders type-specific fields and document preview, and calls the `BusinessDB` API in `db.js`. Keep database code out of UI handlers where possible. There is no bundler or module loader; scripts are loaded in order at the end of `index.html` (`db.js`, then `app.js`).

The dashboard opens first. The editor autosaves after a short delay and also saves when the user selects Save or navigates away. Saves are serialized so a pending new-document save cannot create duplicates when later edits arrive. Startup opens IndexedDB, runs the one-time legacy migration, then opens the most recently updated document or prepares an unsaved quotation draft. The live preview is assembled from the current form and is also the printable output; print CSS hides navigation, editing controls, and app chrome.

## IndexedDB rules

- Database: `business_document_manager`, schema version `2`.
- Object stores, all keyed by `id`:
  - `companies`: latest company details used by documents.
  - `parties`: customer and supplier details, keyed using a normalized name-based ID.
  - `documents`: complete document records; indexes are unique `number`, non-unique `type`, `sourceId`, and `createdAt`.
  - `lineItems`: line item records with a non-unique `documentId` index.
  - `sequences`: numbering counters keyed by document type and local calendar date.
- A document record contains identifiers/status/source references, company, document metadata and type-specific values, project, client, items, financial values, payment details, terms, and created/updated timestamps. `items` are included in the document record and also written to `lineItems` for indexed access. Keep both representations consistent.
- Creating or updating documents and related company/party records is performed in read-write transactions. Do not split dependent writes into unrelated transactions.
- Numbering is assigned in `BusinessDB.createDocument`; numbers use a type prefix, local timestamp, and padded sequence. Updating a document preserves its number and type. Do not allocate numbers in UI code.
- Schema changes require incrementing `DB_VERSION` and adding an idempotent migration in `onupgradeneeded`. Preserve existing user data and old records.
- Backup JSON uses format `business_document_manager`, includes a backup format version, database version, export timestamp, and all stores. Import validates each store, then merges in one read-write transaction. Existing IDs are skipped rather than overwritten; a conflicting unique document number aborts the full import without partial writes.
- Legacy migration imports `dlaw_current_document` once and marks success with `business_document_manager_migration_v1` only after verification. Never remove legacy data before verification.

## Document types and workflows

Supported types are Quotation (`QUO`), Estimate (`EST`), Invoice (`INV`), Proforma Invoice (`PRO`), Receipt (`REC`), Purchase Order (`PO`), Credit Note (`CN` in `db.js`), and Delivery Note (`DN`). Type-specific fields and default terms are declared in `app.js`.

- Accepted quotations can convert to one invoice; the invoice starts Unpaid and references its source.
- Estimates can convert to one quotation.
- Paid or partially paid invoices can create receipts. Receipt creation records a payment on the source invoice and updates its status. Duplicate transaction references for one invoice are rejected.
- Invoices can create credit notes up to the remaining eligible invoice balance. Credit note creation records the source and validates its amount in the database transaction.
- Conversion keeps the original and creates a related document. Related/source references are shown in the editor history.
- Other supported document types can be created and edited directly. Do not add conversion controls unless the workflow is implemented end to end.
- Status choices are type-specific. Quotation statuses: Draft, Sent, Accepted, Rejected, Expired. Invoice statuses: Unpaid, Partially Paid, Paid, Overdue. Other types: Draft and Final.

## UI and accessibility conventions

- Keep the interface professional, calm, and document focused. The current palette uses deep green for primary actions, warm gold for emphasis, off-white workspace surfaces, and neutral green-gray text/borders.
- Use system sans-serif typography, consistent spacing, restrained shadows, and clear form labels. Prefer shared classes over inline styling and keep controls touch friendly.
- The editor and preview form the primary desktop layout; at narrower widths they stack. The printable preview must remain legible on mobile and must not introduce horizontal page overflow. The line-item editor may scroll horizontally inside its own wrapper.
- Preserve the print stylesheet: business document content prints, while editing controls and app chrome do not.
- Maintain visible keyboard focus, semantic labels, accessible names for icon-only buttons, table captions, live toast announcements, and reduced-motion support.
- Do not add navigation or controls that imply unsupported screens or actions. If implementing a larger feature, make its workflow real and update this guide.

## Application views

- Dashboard summaries and recent documents are read from IndexedDB.
- All Documents is the single saved-document management view; it supports search, type filtering, view, edit, duplicate, and delete actions. The editor keeps conversion controls and relationship history, without a second saved-document selector or delete action.
- Customers are assembled from saved customer records and document client details.
- Company Profile stores the default company details used for newly created documents.
- Settings contains Data & Backup. Import is a safe merge and requires confirmation.
- Desktop and tablet use a labeled sidebar, and mobile uses bottom navigation. The New Document dialog requires choosing a document type before opening the editor.

## Coding standards

- Use vanilla JavaScript and existing browser APIs; do not introduce React, a backend, PostgreSQL, or dependencies without explicit approval.
- Inspect relevant existing code before changing behavior. Make incremental changes and preserve current document formats and workflows.
- Keep persistence operations in `db.js` and UI/rendering logic in `app.js`; use descriptive names and handle rejected asynchronous operations visibly.
- Escape user-provided strings inserted into HTML. Prefer `textContent` and DOM methods where practical.
- Preserve backward compatibility and IndexedDB data. Never silently remove an existing feature or alter record meaning without a migration.
- Update this file when architecture, schema, dependencies, project structure, or important workflows change.

## Instructions for future coding agents

1. Read `AGENTS.md` before modifying the project.
2. Inspect existing code before implementing features.
3. Do not unnecessarily rewrite existing functionality.
4. Do not introduce React, a backend, or PostgreSQL without explicit approval.
5. Keep IndexedDB as the local database unless the architecture is deliberately changed.
6. Preserve existing user data and database compatibility.
7. Update `AGENTS.md` whenever architecture, database schema, dependencies, or important workflows change.
8. Test changes before declaring them complete, when testing is requested and available; report clearly what was and was not checked.
9. Never silently remove existing features.
10. Explain important architectural decisions and files changed.
