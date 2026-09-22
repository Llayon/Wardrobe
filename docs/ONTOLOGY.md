# Item Ontology Proposal (Gauntlet 0 — proposal, not final schema)

Canonical IDs are lowercase `snake_case`, stable across locales. Display
names are Russian (user-editable at confirm time).

## Categories

| canonical | display (ru)   | notes                               |
| --------- | -------------- | ----------------------------------- |
| outerwear | Верхняя одежда | куртки, пальто, плащи               |
| top       | Верх           | футболки, рубашки, свитеры          |
| bottom    | Низ            | брюки, джинсы, юбки, шорты          |
| dress     | Платье         | платья, комбинезоны (one-piece)     |
| shoes     | Обувь          | любая                               |
| accessory | Аксессуары     | сумки, ремни, шарфы, головные уборы |

One-piece rule: a dress occupies top+bottom slots in outfit composition
(next gauntlet consumes this; storage just records the category).

## Colors (multi per item, ordered by dominance)

`black white gray beige brown navy blue red green yellow orange pink purple
multicolor metallic` — display-mapped to Russian (`Чёрный`, `Белый`, …).
Vision returns up to 2, dominant first. User can edit at confirm.

## Seasons (optional at scan, editable; cheap now, expensive later)

`all` (default) `summer` `demi` `winter`. Outfit generation filters by
season when the user picks one; `all` always matches.

## Patterns (optional, v2 if noisy)

`solid striped floral graphic check` — record when confident, else omit.
Do NOT block MVP on pattern accuracy; category+color carry the product.

## Item record (storage shape)

```json
{
  "id": "uuid (server)",
  "canonicalName": "black_jeans",
  "displayName": "Чёрные джинсы",
  "category": "bottom",
  "colors": ["black"],
  "season": "all",
  "status": "active",
  "sourceRequestId": "client uuid (idempotent confirm)",
  "thumbnail": { "webpBytes": 68400, "width": 512, "height": 512, "sha256": "…" }
}
```

## Outfit record (NEXT gauntlet, drafted)

```json
{
  "id": "uuid",
  "occasion": "office | evening | sport | … (user label)",
  "itemIds": ["uuid ×2..5, must all exist and be active"],
  "note": "why this works (1–2 lines)"
}
```

Server enforces: generation returns EXACTLY 3 outfits; every referenced ID
exists, belongs to the caller, and is active — otherwise the generation is
rejected, never silently trimmed.
