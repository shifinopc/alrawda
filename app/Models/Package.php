<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Package extends Model
{
    public const DISCOUNT_TYPE_PERCENTAGE = 'percentage';
    public const DISCOUNT_TYPE_FIXED = 'fixed';

    public const ROUNDING_NONE = 'none';
    public const ROUNDING_NEAREST_5 = 'nearest_5';
    public const ROUNDING_NEAREST_10 = 'nearest_10';
    public const ROUNDING_NEAREST_50 = 'nearest_50';
    public const ROUNDING_CUSTOM = 'custom';

    protected $fillable = [
        'name',
        'description',
        'discount_type',
        'discount_value',
        'rounding_rule',
        'rounding_target',
    ];

    protected $casts = [
        'discount_value' => 'decimal:2',
        'rounding_target' => 'decimal:2',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(PackageItem::class, 'package_id')->with('service');
    }

    public function invoiceItems(): HasMany
    {
        return $this->hasMany(InvoiceItem::class, 'package_id');
    }

    /**
     * Raw package taxable (sum of children, before discount/rounding).
     */
    public function getRawTaxableAmount(): float
    {
        $sum = $this->items->sum(fn (PackageItem $item) => $item->line_taxable);
        return round($sum, 2);
    }

    /**
     * Raw package non-taxable (sum of children, before discount/rounding).
     */
    public function getRawNonTaxableAmount(): float
    {
        $sum = $this->items->sum(fn (PackageItem $item) => $item->line_non_taxable);
        return round($sum, 2);
    }

    /**
     * Raw total (excl. VAT) = raw taxable + raw non-taxable.
     */
    public function getRawTotalExclVat(): float
    {
        return round($this->getRawTaxableAmount() + $this->getRawNonTaxableAmount(), 2);
    }

    /**
     * Apply discount to taxable amount only; non-taxable stays unchanged. VAT is then calculated on reduced taxable.
     *
     * @return array{0: float, 1: float} [discounted_taxable, discounted_non_taxable]
     */
    public function getDiscountedAmounts(): array
    {
        $rawTaxable = $this->getRawTaxableAmount();
        $rawNonTaxable = $this->getRawNonTaxableAmount();

        $discountAmount = 0.0;
        if ($this->discount_type === self::DISCOUNT_TYPE_PERCENTAGE && $this->discount_value !== null) {
            $discountAmount = $rawTaxable * ((float) $this->discount_value / 100);
        } elseif ($this->discount_type === self::DISCOUNT_TYPE_FIXED && $this->discount_value !== null) {
            $discountAmount = min((float) $this->discount_value, $rawTaxable);
        }

        $discountedTaxable = round(max(0.0, $rawTaxable - $discountAmount), 2);
        $discountedNonTaxable = round($rawNonTaxable, 2);

        return [$discountedTaxable, $discountedNonTaxable];
    }

    /**
     * Apply rounding to (optionally discounted) total; return [taxable, non_taxable] after proportional allocation.
     *
     * @return array{0: float, 1: float} [rounded_taxable, rounded_non_taxable]
     */
    public function getRoundedAmounts(): array
    {
        [$taxable, $nonTaxable] = $this->getDiscountedAmounts();
        $total = $taxable + $nonTaxable;

        if ($total <= 0) {
            return [0.0, 0.0];
        }

        $roundedTotal = $total;
        $rule = $this->rounding_rule ?? self::ROUNDING_NONE;

        switch ($rule) {
            case self::ROUNDING_NEAREST_5:
                $roundedTotal = round($total / 5) * 5;
                break;
            case self::ROUNDING_NEAREST_10:
                $roundedTotal = round($total / 10) * 10;
                break;
            case self::ROUNDING_NEAREST_50:
                $roundedTotal = round($total / 50) * 50;
                break;
            case self::ROUNDING_CUSTOM:
                if ($this->rounding_target !== null) {
                    $roundedTotal = (float) $this->rounding_target;
                }
                break;
            default:
                return [$taxable, $nonTaxable];
        }

        $roundedTotal = round($roundedTotal, 2);
        $ratio = $taxable / $total;
        $roundedTaxable = round($roundedTotal * $ratio, 2);
        $roundedNonTaxable = round($roundedTotal - $roundedTaxable, 2);

        return [$roundedTaxable, $roundedNonTaxable];
    }

    /**
     * Final package taxable amount (after discount and rounding) — use for invoice line.
     */
    public function getPackageTaxableAmount(): float
    {
        [$t] = $this->getRoundedAmounts();
        return $t;
    }

    /**
     * Final package non-taxable amount (after discount and rounding) — use for invoice line.
     */
    public function getPackageNonTaxableAmount(): float
    {
        [, $nt] = $this->getRoundedAmounts();
        return $nt;
    }

    /**
     * Final package total (excl. VAT) — for display.
     */
    public function getPackageTotalExclVat(): float
    {
        return round($this->getPackageTaxableAmount() + $this->getPackageNonTaxableAmount(), 2);
    }
}
