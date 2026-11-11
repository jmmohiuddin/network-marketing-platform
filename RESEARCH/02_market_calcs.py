"""
Derived metrics for 02_MARKET_SIZE_AND_OPPORTUNITY.md.
All inputs are copied from WFDSA STATS Report 2024 (Nov 2025), source S-001.
Nothing here is an estimate of software market size; these are descriptive ratios only.
Rep counts include everyone who signed an independent-contractor agreement
(including inactive and discount-only buyers), so per-rep figures are NOT earnings.
"""

GLOBAL_SALES = 163_863        # USD millions, 2024
GLOBAL_REPS = 104_338_049

# market: (2024 retail sales USD M, independent reps, 2024 YoY %, 3-yr CAGR %)
markets = {
    "United States": (34_740, 12_180_000, -5.2, -6.6),
    "Malaysia":      (10_197,  9_609_326,  2.1,  9.0),
    "India":         ( 3_528,  8_806_000,  4.0,  7.0),
    "Thailand":      ( 1_980, 10_900_000, -7.1, -6.4),
    "United Kingdom":( 1_171,    331_011,  0.8, -10.5),
    "Indonesia":     ( 1_092,  8_331_000, -11.3, -7.3),
    "Vietnam":       (   894,    695_778, -3.9, -5.3),
    "Philippines":   (   855,  2_468_763, -11.4, -9.7),
    "Singapore":     (   442,    557_894, -1.8,  0.2),
}
# Not decomposed by rep count in the extracted text
others = {
    "Germany": 19_050,
    "France": 4_714,
    "Italy": 2_930,
    "EU-27 total": 31_315,
    "United Arab Emirates (WFDSA research estimate)": 31.7,
}

print(f"{'Market':<18}{'Sales $M':>10}{'% global':>10}{'Reps':>13}{'$ per rep':>11}{'YoY %':>8}{'CAGR %':>8}")
for name, (s, r, yoy, cagr) in markets.items():
    print(f"{name:<18}{s:>10,}{100*s/GLOBAL_SALES:>9.2f}%{r:>13,}{1e6*s/r:>11,.0f}{yoy:>8.1f}{cagr:>8.1f}")

print()
print("Share of global sales, markets without rep decomposition:")
for name, s in others.items():
    print(f"  {name}: ${s:,.1f}M = {100*s/GLOBAL_SALES:.3f}% of global")

print()
print(f"Global: ${GLOBAL_SALES:,}M, {GLOBAL_REPS:,} reps -> ${1e6*GLOBAL_SALES/GLOBAL_REPS:,.0f} retail sales per rep contract")

# Definition sensitivity for the US (same market, three different 'seller' definitions)
us_sales = 34_740
for label, n in [("WFDSA reps who signed/renewed contracts (12.18M)", 12_180_000),
                 ("DSA 'actively engaged' direct sellers (5.4M)", 5_400_000)]:
    print(f"US retail sales per person, {label}: ${1e6*us_sales/n:,.0f}")

# Check: restatement between the 2023 report and the 2024 report
r2023_original = 167_694   # S-002, constant 2023 USD, published Aug 2024
r2023_restated = 163_937   # S-001, constant 2024 USD
print()
print(f"2023 global as first published: ${r2023_original:,}M; as restated in 2024 report: ${r2023_restated:,}M; "
      f"difference {100*(r2023_restated/r2023_original-1):.2f}%")

# Check: WFDSA 3-yr CAGR 2021->2024
v2021, v2024 = 170_023, 163_863
print(f"Global 2021->2024 CAGR check: {100*((v2024/v2021)**(1/3)-1):.2f}% (report says -1.2%)")

# Sanity check on the Asia/Pacific rep total
ap_reps = [397_243, 3_119_000, 239_644, 8_806_000, 8_331_000, 2_235_261, 2_262_334,
           8_091_124, 9_609_326, 93_801, 2_468_763, 557_894, 3_733_000, 10_900_000,
           695_778, 802_100]
print(f"Asia/Pacific rep components sum to {sum(ap_reps):,} (report total 62,342,268)")

# ---------------------------------------------------------------------------
# Addendum (Wave 1 write-up checks). All arithmetic on figures quoted in the
# source register; none of this is a forecast or a software-market estimate.
# ---------------------------------------------------------------------------
print()
print("Regional split check (S-001, USD M):")
regions = {"Asia/Pacific": 66_058, "Americas": 61_189, "Europe": 35_352, "Africa/Middle East": 1_265}
for k, v in regions.items():
    print(f"  {k}: {v:,} = {100*v/GLOBAL_SALES:.1f}%")
print(f"  sum = {sum(regions.values()):,} vs global {GLOBAL_SALES:,} (rounding gap {sum(regions.values())-GLOBAL_SALES:+d})")

print()
print("Share of global reps vs share of global sales (contract signers, so rep share overstates active sellers):")
for name, (s, r, yoy, cagr) in markets.items():
    print(f"  {name:<16} reps {100*r/GLOBAL_REPS:5.1f}%  sales {100*s/GLOBAL_SALES:5.1f}%")

print()
print("US definition nesting (S-004): 5.4M 'actively engaged' is a subset of 12.2M contract signers")
print(f"  5.4 / 12.2 = {100*5.4/12.2:.1f}%")

print()
print("Malaysia: Bernama 10 Mar 2025 (S-014) RM34.4B vs WFDSA USD 10,197M")
rm_bernama = 34_400
rm_wfdsa = 46_667   # S-001 pp. 43 and 47, 'local currency (millions)' column for Malaysia (currency not labeled in the report)
print(f"  Implied RM per USD if both measured the same thing: {rm_bernama/10_197:.2f}")
print(f"  RM per USD implied by S-001 local-currency figure:   {rm_wfdsa/10_197:.2f}")
print(f"  WFDSA local figure / Bernama figure = {rm_wfdsa/rm_bernama:.2f}x  (scope/definition gap, cause [UV])")
print(f"  Bernama stated 2024 growth {100*(34.4/32.04-1):.1f}% (RM) vs S-001 Malaysia YoY +2.1% (USD)")

print()
print("Arithmetic on PUBLIC ENTRY-PRICE ANCHORS (directory listings, Grade C). Not a market size, not a forecast.")
for label, monthly in [("MarketPowerPRO listing from $499/mo", 499), ("ByDesign 'Freedom' listing from $2,500/mo", 2_500)]:
    annual = monthly * 12
    print(f"  {label}: ${annual:,}/yr list entry price -> {1_000_000/annual:,.0f} customers per $1M of annual revenue at entry price")
