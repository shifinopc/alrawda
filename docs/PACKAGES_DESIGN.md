# Package Design: Multi-Service Packages with Discount and Rounding

## 1. Overview

**Single services** (current): One sellable item with its own taxable and non-taxable amount; invoiced as one line.

**Packages**: A sellable unit that groups **several services** (children). Each child has its own taxable and non-taxable amount. The **package totals** are the sum of all children (taxable and non-taxable). The package is **invoiced as one line** against the customer using these package totals. Optionally, packages can have a **discount** and/or **rounding** so the final invoiced amount is a round figure (e.g. 695 → 670).

---

## 2. Concepts (Standardized)

### 2.1 Package

- **Definition**: A named bundle of one or more **child services**, sold as a single line on an invoice.
- **Package totals** (before discount/rounding):
  - `package_taxable_amount` = sum over children of `(child taxable_amount × quantity)`
  - `package_non_taxable_amount` = sum over children of `(child non_taxable_amount × quantity)`
- **Invoicing**: One invoice line per package; that line uses the package’s **final** taxable and non-taxable amounts (after discount and rounding). VAT is applied only on the taxable portion.

### 2.2 Child Services (Package Items)

- Each **package item** links a **service** to the package with a **quantity**.
- Each child contributes:
  - **Taxable amount** (per unit): from the service’s `taxable_amount`, or an optional override on the package item.
  - **Non-taxable amount** (per unit): from the service’s `non_taxable_amount`, or an optional override on the package item.
- Child totals (for the package):
  - `child_taxable = taxable_per_unit × quantity`
  - `child_non_taxable = non_taxable_per_unit × quantity`

### 2.3 Package Totals (Raw)

- **Raw package taxable** = sum of all `child_taxable`.
- **Raw package non-taxable** = sum of all `child_non_taxable`.
- **Raw package total (excl. VAT)** = raw package taxable + raw package non-taxable.

### 2.4 Discount (Optional)

- **When**: Some packages need a discount (e.g. bundle offer).
- **Types**:
  - **Percentage**: e.g. 10% off the **taxable amount** of the package.
  - **Fixed**: e.g. 50 AED off the **taxable amount** of the package.
- **Application**: Discount is applied to the **taxable amount only**. Non-taxable stays unchanged. VAT is then calculated on the **reduced taxable** amount.

**Formulas:**

- **Percentage (e.g. 10%)**: `discount_amount = raw_taxable × (10/100)`; `discounted_taxable = raw_taxable − discount_amount`; `discounted_non_taxable = raw_non_taxable` (unchanged).
- **Fixed (e.g. 50 AED)**: `discount_amount = min(50, raw_taxable)`; `discounted_taxable = raw_taxable − discount_amount`; `discounted_non_taxable = raw_non_taxable` (unchanged).

### 2.5 Rounding (Optional)

- **When**: Final amount should be a round figure (e.g. 695 → 670, or to nearest 10).
- **Options**:
  - **None**: No rounding; use discounted (or raw) amounts as-is.
  - **Nearest 5**: Round total (excl. VAT) to nearest 5 (e.g. 693 → 695, 692 → 690).
  - **Nearest 10**: Round to nearest 10.
  - **Nearest 50**: Round to nearest 50.
  - **Custom target**: Round (or set) total to an exact value (e.g. 670). Used when the business wants a specific figure.

- **Application**: Rounding is applied to the **package total (excl. VAT)** after discount. The **rounded total** is then split back into taxable and non-taxable **in the same proportion** as after discount, so:
  - VAT is correct (only on taxable).
  - Rounded taxable + rounded non-taxable = rounded total.

**Example (695 → 670):**

- After discount: taxable = 400, non-taxable = 295, total = 695.
- Rounding: custom target 670.
- Rounded total = 670. Ratio = 400/695; rounded_taxable = 670 × (400/695), rounded_non_taxable = 670 − rounded_taxable (then round to 2 decimals if needed).

---

## 3. Flow Summary

1. **Create package**: Add package items (service + quantity, optional per-unit amount overrides).
2. **Compute raw totals**: Sum children’s taxable and non-taxable.
3. **Apply discount** (if any): Get discounted total; allocate proportionally to taxable and non-taxable.
4. **Apply rounding** (if any): Get rounded total; allocate proportionally to taxable and non-taxable.
5. **Invoice**: Add **one line** with the package’s final taxable and non-taxable; VAT and grand total follow existing invoice logic.

---

## 4. Data Model (Summary)

- **packages**: id, name, description, discount_type (null | percentage | fixed), discount_value, rounding_rule (null | nearest_5 | nearest_10 | nearest_50 | custom), rounding_target (for custom).
- **package_items**: package_id, service_id, quantity, optional taxable_amount override, optional non_taxable_amount override (if null, use service’s amounts).
- **invoice_items**: existing fields; add optional **package_id**. If package_id is set, the line uses the package’s **final** taxable and non-taxable (and may leave service_id null or keep it for display of “package” vs “service” if needed).

---

## 5. Rounding Rules (Reference)

| Rule         | Description                    | Example (693.50) |
|-------------|--------------------------------|-------------------|
| `none`      | No rounding                    | 693.50            |
| `nearest_5` | Round to nearest 5             | 695.00            |
| `nearest_10`| Round to nearest 10            | 690.00            |
| `nearest_50`| Round to nearest 50            | 700.00            |
| `custom`    | Use `rounding_target` (e.g. 670) | 670.00          |

---

## 6. Invoice Flow (Summary)

- **Single service line**: `invoice_items.service_id` is set, `package_id` is null. Taxable/non-taxable come from the service × quantity (existing behaviour).
- **Package line**: `invoice_items.package_id` is set, `quantity` is typically 1. Taxable and non-taxable are set from the package’s **final** amounts (`getPackageTaxableAmount()`, `getPackageNonTaxableAmount()`). VAT is calculated on the taxable amount; one line represents the whole package.
- When creating/updating an invoice, if the user selects a package, the backend should resolve the package’s final taxable and non-taxable (after discount and rounding) and create one invoice item with those values.

---

## 7. Discount Rules (Reference)

| Type         | discount_value | Effect                          |
|--------------|----------------|----------------------------------|
| `percentage` | 10             | 10% off raw package total       |
| `fixed`      | 50             | 50 AED off raw package total    |
| null         | -              | No discount                     |

This document is the single source of truth for package behaviour, discount, and rounding in the application.
