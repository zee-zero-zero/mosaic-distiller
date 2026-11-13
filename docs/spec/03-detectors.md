# 3. Detectors: the default rule pack

This part lists every rule of the default rule pack (`rulepacks/default.json`): its pattern, its
edges, its validators, examples it must hit and must not hit, and where there is one, its
**residual risk**. The rule pack file is written from this part, and the examples become
conformance cases (§5.5).

The examples are documentation values, library test values, or values computed for this
specification. None is real personal data known to us. Each was checked against its validator on
2026-11-11.

Patterns are written as they go into the rule pack. In tables, `\|` is a Markdown escape for `|`.
Patterns follow the portable subset of §2.4.1, edges are those of §2.4.3, and validators are
those of §3.5.

## 3.1 The bar: precision first

A rule is included only if a match is close to certain from the value alone. No rule reads the
words around a value or relies on a label. A personal-data rule qualifies in one of two ways:

1. **A digit run whose check and structure are strong.** A run of digits, with or without generic
   separators, qualifies only when its check and embedded structure accept about **1 in 1,000 or
   fewer** of the random values of its shape. That rate was measured for every candidate on
   400,000 random values.
2. **A layout of the issuer's own that ordinary text does not use.** Letters at fixed positions, a
   literal (`756.`, `〒`, a parenthesised check digit, a century sign), or the issuer's own
   separators (`390.533.447-05`). The check is applied where one exists. Where the check is weak
   or absent, the entry states its residual risk.

Recall is given up for precision. Everything researched and left out is listed in §3.6, with its
measured rate and what it would need.

**Kept with a weak check or none.** Eight shapes are kept only because their layout is the
issuer's own: hyphenated US SSNs, North American phone numbers, Medicare beneficiary numbers,
payment cards, Korean resident numbers, Indian PAN, UK National Insurance numbers and UK driving
licences. Each can be moved to §3.6 by one decision (§7).

**Two secret rules break the bar on purpose.** `secret.keyed_value` and `secret.query_param`
recognise a secret by the name written before it, such as `password=`. That is reading a word
next to the value, which the bar forbids for personal data. They are kept because a leaked secret
does the most harm, and because these two rules are long-established scrubber practice (§7).

## 3.2 Categories

Category identifiers are `family.category`. A validator may add a **variant**, such as
`private` on an IPv4 address or `ltc` on a crypto address. The class is the default sensitivity.

| Family | Categories | Class |
|---|---|---|
| `secret` | `url_credential`, `query_param`, `auth_header`, `bearer`, `extraheader`, `keyed_value`, `vendor_key`, `private_key`, `jwt` | high |
| `gov_id` | North America: `us_ssn`, `us_itin`; Europe: `be_nn`, `ch_ahv`, `cz_rc`, `es_dni`, `es_nie`, `fi_hetu`, `fr_nir`, `gb_nino`, `gb_driving_licence`, `ie_pps`, `it_cf`, `no_fnr`, `se_pnr`; Asia-Pacific: `cn_ric`, `hk_hkid`, `in_pan`, `kr_rrn`, `sg_nric`; Latin America and Africa: `br_cpf`, `mx_curp`, `za_id`; any country: `mrz` | high |
| `health_id` | `us_mbi` | high |
| `financial` | `payment_card`, `iban`, `crypto_address` | high |
| `org_id` | `ca_bn`, `eu_vat`, `cn_uscc`, `in_gstin`, `br_cnpj` | low (a sole proprietor's number is personal) |
| `contact` | `email`, `phone`, `postal_code` (variants `ca`, `gb`, `jp`) | medium |
| `network` | `ipv4`, `ipv6`, `mac` | medium; private and loopback ranges low |
| `vehicle` | `vin` | medium |
| `dictionary` | one category per term list, `dictionary.<name>` | set by the caller; `high` by default |
| `inject`, `hidden` | §3.7 | defend findings, not personal data |

**Rule ids.** A rule's id is its category when one rule serves the category. Where several rules
share a category, each id adds a suffix: `org_id.eu_vat.at`, `secret.vendor_key.google`,
`contact.postal_code.gb`.

## 3.3 Personal data

### 3.3.1 North America

- **`gov_id.us_ssn`**: `[0-9]{3}-[0-9]{2}-[0-9]{4}`, edges `numeric`. Validator `ssn_rules`.
  - Hit: `536-22-8914`.
  - Not: `078-05-1120`, `666-12-3456`, `536-00-8914`, `536 22 8914`, `912-73-4567`.
  - Residual risk: no checksum. Another number written as `ddd-dd-dddd` with a valid area and group
    would hit. `078-05-1120` is a voided number once printed in a wallet insert; `912-73-4567` is an
    ITIN, taken by the next rule.
- **`gov_id.us_itin`**: `9[0-9]{2}-[0-9]{2}-[0-9]{4}`, edges `numeric`. Validator `itin_rules`.
  - Hit: `912-73-4567`.
  - Not: `912-34-5678`.
- **`health_id.us_mbi`**: `[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9][0-9]-[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9][0-9]-[AC-HJKMNP-RT-Y]{2}[0-9]{2}`,
  edges `word`. The Medicare Beneficiary Identifier in its printed 4-3-4 form.
  - Hit: `1EG4-TE5-MK73`.
  - Not: `1EG4-TS5-MK73`.
  - Residual risk: no checksum. Eleven characters with a type fixed at every position, and letters
    without S, L, O, I, B and Z. `1EG4-TE5-MK73` is CMS's own sample.
- **`org_id.ca_bn`**: `[0-9]{9}[ ]?R[CMPRTZ][ ]?[0-9]{4}`, edges `word`. Validator `ca_bn`. A
  business number with its program account (RT GST/HST, RP payroll, RC corporate tax, RZ information
  returns, RM import/export, RR charity).
  - Hit: `123026635 RC 0001`.
  - Not: `123456789 RT 0001`.
  - Residual risk: the business number fails Luhn in `123456789 RT 0001`, so that string is not a hit.

### 3.3.2 Europe

- **`gov_id.be_nn`**: `[0-9]{2}\.[0-9]{2}\.[0-9]{2}-[0-9]{3}\.[0-9]{2}`, edges `numeric`. Validator
  `be_nn`. Belgium's national number in its printed form.
  - Hit: `85.07.30-033.28`.
  - Not: `85.07.30-033.29`.
  - Residual risk: 1 in 990 random 11-digit values pass, before the layout narrows them further.
- **`gov_id.ch_ahv`**: `756\.[0-9]{4}\.[0-9]{4}\.[0-9]{2}`, edges `numeric`. Validator `ean13`.
  Switzerland's AHV/AVS number.
  - Hit: `756.9217.0769.85`.
  - Not: `756.9217.0769.84`.
- **`gov_id.cz_rc`**: `[0-9]{6}/[0-9]{4}`, edges `numeric`. Validator `cz_rc`. The Czech and Slovak
  birth number with its slash.
  - Hit: `710319/2745`.
  - Not: `710319/2746`.
  - Residual risk: 1 in 48 random values of the shape pass. The `######/####` layout is what keeps it.
    Nine-digit numbers (births before 1954) have no check and are not taken.
- **`gov_id.es_dni`**: `[0-9]{8}-?[TRWAGMYFPDXBNJZSQVHLCKE]`, edges `word`. Validator `es_dni`.
  - Hit: `54362315K`, `54362315-K`.
  - Not: `54362315Z`.
  - Residual risk: 1 in 23 random values of the shape pass.
- **`gov_id.es_nie`**: `[XYZ]-?[0-9]{7}-?[TRWAGMYFPDXBNJZSQVHLCKE]`, edges `word`. Validator
  `es_nie`.
  - Hit: `X2482300W`.
  - Not: `X2482300A`.
  - Residual risk: 1 in 23 random values of the shape pass.
- **`gov_id.fi_hetu`**: `[0-3][0-9][01][0-9]{3}[-+A-FU-Y][0-9]{3}[0-9A-FHJ-NPR-Y]`, edges `word`.
  Validator `fi_hetu`. Finland's personal identity code, with its century sign.
  - Hit: `131052-308T`.
  - Not: `131052-308U`, `310252-308Y`.
  - Residual risk: 1 in 68 random values of the shape pass. `310252-308Y` fails because 31 February
    is not a date.
- **`gov_id.fr_nir`**: `[12] [0-9]{2} [0-9]{2} (?:[0-9]{2}|2A|2B) [0-9]{3} [0-9]{3} [0-9]{2}`, edges
  `numeric`. Validator `fr_nir`. France's NIR in its printed grouping.
  - Hit: `2 95 10 99 126 111 93`.
  - Not: `2 95 10 99 126 111 99`.
  - Residual risk: 1 in 503 random values of the shape pass. Unformatted NIRs are left out (§3.6).
- **`gov_id.gb_nino`**: `[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] [0-9]{2} [0-9]{2} [0-9]{2} [A-D]`, edges
  `word`. Validator `nino_prefix`. The UK National Insurance number in its printed spacing.
  - Hit: `HH 01 23 45 D`.
  - Not: `QQ 12 34 56 C`, `GB 12 34 56 A`.
  - Residual risk: no checksum. `QQ 12 34 56 C` is the usual dummy and contains a letter never used;
    GB is an excluded prefix.
- **`gov_id.gb_driving_licence`**: `[A-Z9]{5}[0-9](?:0[1-9]|1[0-2]|5[1-9]|6[0-2])(?:0[1-9]|[12][0-9]|3[01])[0-9][A-Z9]{2}[A-Z0-9][A-Z]{2}`,
  edges `word`. Validator `gb_dl_surname`. The DVLA driver number (16 characters).
  - Hit: `MORGA753116SM9IJ`.
  - Not: `99999753116SM9IJ`.
  - Residual risk: the DVLA's two check characters are not public, so only the structure is checked.
    The structure is the surname padded with 9, the birth date with the month plus 50 for women, and
    the initials. `MORGA753116SM9IJ` is the widely circulated specimen, not confirmed against a DVLA
    source.
- **`gov_id.ie_pps`**: `[0-9]{7}[A-W][ABHWTX]?`, edges `word`. Validator `ie_pps`.
  - Hit: `6433435F`, `6433435FW`.
  - Not: `6433435E`.
  - Residual risk: 1 in 23 random values of the shape pass.
- **`gov_id.it_cf`**: `[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]`,
  edges `word`. Validator `it_cf`. Italy's codice fiscale.
  - Hit: `RCCMNL83S18D969H`.
  - Not: `RCCMNL83S18D969A`.
- **`gov_id.no_fnr`**: `[0-9]{6} [0-9]{5}`, edges `numeric`. Validator `no_fnr`. Norway's birth
  number in its printed spacing.
  - Hit: `151086 95088`.
  - Not: `151086 95077`.
  - Residual risk: 1 in 867 random values of the shape pass.
- **`gov_id.se_pnr`**: `[0-9]{6}[-+][0-9]{4}|[0-9]{8}-[0-9]{4}`, edges `numeric`. Validator `se_pnr`.
  Sweden's personnummer with its separator; `+` marks age 100 or more.
  - Hit: `880320-0016`, `19880320-0016`.
  - Not: `880320-0018`.
  - Residual risk: 1 in 275 random values of the shape pass. A Danish CPR number has the same layout
    and no checksum; one passing Luhn by chance is labelled Swedish, and it is personal data either way.
- **`org_id.eu_vat`**: one rule per country, the prefix being part of the value, edges `word`.
  Validator `eu_vat` (by country).
  - AT: `ATU[0-9]{8}`
  - BE: `BE ?[01][0-9]{9}`
  - DE: `DE ?[1-9][0-9]{8}`
  - ES: `ES ?[0-9A-Z][0-9]{7}[0-9A-Z]`
  - FR: `FR ?[0-9A-HJ-NP-Z]{2}[0-9]{9}`
  - IT: `IT ?[0-9]{11}`
  - NL: `NL ?[0-9]{9}B[0-9]{2}`
  - PL: `PL ?[0-9]{10}`
  - SE: `SE ?[0-9]{10}01`

  Hits: `ATU13585627`, `BE0428759497`, `DE136695976`, `ESB64717838`, `FR23334175221`, `IT00743110157`,
  `NL004495445B01`, `PL8567346215`, `SE123456789701`. Not: `DE136695978`, `ATU13585626`.

### 3.3.3 Asia-Pacific

- **`gov_id.cn_ric`**: `[1-8][0-9]{5}(?:18|19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9X]`,
  edges `word`. Validator `cn_ric`. China's resident identity number: region, birth date, sequence,
  ISO 7064 MOD 11-2 check.
  - Hit: `360426199101010071`.
  - Not: `360426199101010072`.
  - Residual risk: 1 in 303 among values that already fit the pattern's date. Of all random 18-digit
    runs, fewer than 1 in 10,000 pass. The region code is not checked against the national list
    (python-stdnum ships that list).
- **`gov_id.hk_hkid`**: `[A-NP-Z]{1,2}[0-9]{6}\([0-9A]\)`, edges `word`. Validator `hkid`. Hong
  Kong's identity card number with its check digit in parentheses.
  - Hit: `G123456(A)`, `AB987654(3)`.
  - Not: `C567890(8)`.
  - Residual risk: 1 in 11 random values of the shape pass; the parenthesised check digit is what makes
    the layout rare. The algorithm is not published by the government; it is the one every open-source
    validator uses.
- **`gov_id.in_pan`**: `[A-Z]{3}[ABCFGHLJPTK][A-Z][0-9]{4}[A-Z]`, edges `word`. Validator `in_pan`.
  India's permanent account number.
  - Hit: `ACUPA7085R`.
  - Not: `ABMXA3211G`, `ACUPA0000R`.
  - Residual risk: no checksum (the last letter's algorithm is unpublished). Ten characters with a type
    fixed at every position, and a holder-type letter at the fourth.
- **`org_id.in_gstin`**: `(?:0[1-9]|[12][0-9]|3[0-7])[A-Z]{3}[ABCFGHLJPTK][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]`,
  edges `word`. Validator `in_gstin`.
  - Hit: `27AAPFU0939F1ZV`.
  - Not: `27AAPFU0939F1ZO`.
- **`gov_id.kr_rrn`**: `[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])-[1-8][0-9]{6}`, edges
  `numeric`. Validator `kr_rrn`. Korea's resident registration number in its hyphenated form.
  - Hit: `971013-1019902`.
  - Not: `971331-1019902`, `971013-9019902`.
  - Residual risk: no usable check. Since October 2020 new numbers end in random digits, so the old
    checksum would reject real numbers; only the date is checked. `971331-1019902` has month 13. A
    seventh digit of 9 or 0 means a birth in the 1800s and is not taken.
- **`gov_id.sg_nric`**: `[STFGM][0-9]{7}[A-Z]`, edges `word`. Validator `sg_nric`. Singapore's NRIC
  and FIN.
  - Hit: `S0000001I`, `M5043078W`.
  - Not: `T5717279A`.
  - Residual risk: 1 in 11 random values of the shape pass. The algorithm is unpublished; the M series
    (2022 on) rests on one open-source validator.
- **`org_id.cn_uscc`**: `[0-9]{8}[0-9A-HJ-NPQRTUWXY]{10}`, edges `word`. Validators `cn_uscc`,
  `has_letter`. China's unified social credit code.
  - Hit: `91110000600037341L`.
  - Not: `91110000600037341M`.
  - Residual risk: a code made only of digits is not taken. It would compete with bare 18-digit runs,
    where 1 in 31 pass.
- **`contact.postal_code.jp`**: `〒[ ]?[0-9]{3}-[0-9]{4}`, edges `numeric`. The postal mark makes it
  certain.
  - Hit: `〒100-0001`.
  - Not: `100-0001`.

### 3.3.4 Latin America and Africa

- **`gov_id.br_cpf`**: `[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}`, edges `numeric`. Validator `br_cpf`.
  - Hit: `390.533.447-05`.
  - Not: `231.002.999-00`, `111.111.111-11`.
  - Residual risk: 1 in 102 random values of the shape pass. Repeated digits pass the arithmetic and
    are rejected by the validator.
- **`org_id.br_cnpj`**: `[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}/[0-9A-Z]{4}-[0-9]{2}`, edges `word`.
  Validator `br_cnpj`. Includes the alphanumeric format in use from July 2026.
  - Hit: `16.727.230/0001-97`, `12.ABC.345/01DE-35`.
  - Not: `16.727.230/0001-98`.
- **`gov_id.mx_curp`**: `[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[0-9A-Z][0-9]`, edges `word`. Validator
  `mx_curp`.
  - Hit: `BOXW310820HNERXN09`.
  - Not: `BOXW310820HNERXN08`.
- **`gov_id.za_id`**: `[0-9]{13}`, edges `numeric`. Validator `za_id`. South Africa's identity number.
  - Hit: `7503305044089`.
  - Not: `8503305044089`.
  - Residual risk: 1 in 1,273 random 13-digit values pass. This is the only bare digit run kept.

### 3.3.5 Travel documents (any country)

- **`gov_id.mrz`**: the machine-readable zone of passports and identity cards (ICAO Doc 9303). A match
  spans the lines, joined by `\r?\n`. Edges `none`. Validators `mrz_td3`, `mrz_td2` and `mrz_td1`.
  Three layouts:
  - TD3, passports, two lines of 44: `P[A-Z<][A-Z<]{3}[A-Z<]{39}\r?\n[A-Z0-9<]{9}[0-9][A-Z<]{3}[0-9]{6}[0-9][MFX<][0-9]{6}[0-9][A-Z0-9<]{14}[0-9<][0-9]`
  - TD2, two lines of 36: `[ACIP][A-Z<][A-Z<]{3}[A-Z<]{31}\r?\n[A-Z0-9<]{9}[0-9][A-Z<]{3}[0-9]{6}[0-9][MFX<][0-9]{6}[0-9][A-Z0-9<]{7}[0-9]`
  - TD1, identity cards, three lines of 30: `[ACI][A-Z<][A-Z<]{3}[A-Z0-9<]{9}[0-9<][A-Z0-9<]{15}\r?\n[0-9]{6}[0-9][MFX<][0-9]{6}[0-9][A-Z<]{3}[A-Z0-9<]{11}[0-9]\r?\n[A-Z<]{30}`

  Hit, the ICAO specimens:
  ```
  P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
  L898902C36UTO7408122F1204159ZE184226B<<<<<10
  ```
  ```
  I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<
  D231458907UTO7408122F1204159<<<<<<<6
  ```
  Not: the TD3 specimen with its last digit changed to 1. The whole zone is masked, names included. The
  TD1 composite check is not applied until it is confirmed against Doc 9303: two published sample cards
  disagree on it. Visa zones (`V…`) are left out.

### 3.3.6 Financial

- **`financial.payment_card`**: `[0-9](?:[ -]?[0-9]){12,18}`, edges `numeric`. Validators
  `separators_consistent`, `luhn`, `card_iin`.
  - Hit: `4111 1111 1111 1111`, `3782 822463 10005`, `5555555555554444`.
  - Not: `4111 1111 1111 1112`, `1234 5678 9012 3456`.
  - Residual risk: 1 in 10 long digit runs inside a network's range pass Luhn. This is the industry's
    standard detector, kept on that ground. The networks' published test numbers are hits, since a
    rule cannot tell a test number from a real one.
- **`financial.iban`**: `[A-Z]{2}[0-9]{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?`, edges
  `word`. Validator `iban_mod97`, with the country's length.
  - Hit: `GB82 WEST 1234 5698 7654 32`.
  - Not: `GB82 WEST 1234 5698 7654 33`.
- **`financial.crypto_address`**: `[13LMD9A][1-9A-HJ-NP-Za-km-z]{25,34}|(?:bc|ltc)1[02-9ac-hj-np-z]{11,71}`,
  edges `word`. Validators `base58check` and `bech32`.
  - Hit: `1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2`, `bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq`,
    `LT2KVaAy1ppRuxRgrS5RNU3vBsy7RibPeA`, `ltc1qhdhvrwe6rgqns8fz28tee0hphr5x7ulw5exv4w`,
    `DD4KSSuBJqcjuTcvUg1CgUKeurPUFeEZkE`.
  - Not: `1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3`.
  - Residual risk: none in practice; the checksums are cryptographic. The version byte or the bech32
    prefix sets `variant` (`btc`, `ltc`, `doge`).

### 3.3.7 Contact

- **`contact.email`**: `[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}`,
  edges `word`. Validator `email_shape`.
  - Hit: `jane.doe@northwind-mail.com`.
  - Not: `icon@2x.png`, `git@github.com:org/repo.git`, `person1@example.com`.
- **`contact.phone`**: `(?:\+?1[ .-]?)?(?:\([2-9][0-9]{2}\)[ ]?|[2-9][0-9]{2}[ .-])[2-9][0-9]{2}[ .-][0-9]{4}`,
  edges `numeric`. Validators `nanp_rules`, `separators_consistent`. North American numbers only, with
  separators; other countries need libphonenumber's data (§3.6).
  - Hit: `(202) 456-1111`, `+1 613 992 4211`, `202-456-1111`.
  - Not: `(212) 555-0147`, `202-456.1111`, `2026-11-11`.
  - Residual risk: no checksum. Another 3-3-4 number with valid area and exchange codes would hit.
- **`contact.postal_code.ca`**: `[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]`,
  edges `word`.
  - Hit: `K1A 0B1`.
  - Not: `D1A 1A1`, `K1A0B1`.
  - Residual risk: an upper-case code of that exact alternation, such as a part number.
- **`contact.postal_code.gb`**: `GIR 0AA|[A-PR-UWYZ][0-9][ABCDEFGHJKPSTUW]? [0-9][ABD-HJLNP-UW-Z]{2}|[A-PR-UWYZ][0-9]{2} [0-9][ABD-HJLNP-UW-Z]{2}|[A-PR-UWYZ][A-HK-Y][0-9][ABEHMNPRVWXY]? [0-9][ABD-HJLNP-UW-Z]{2}|[A-PR-UWYZ][A-HK-Y][0-9]{2} [0-9][ABD-HJLNP-UW-Z]{2}`,
  edges `word`. Upper case with its space, letters restricted by position.
  - Hit: `SW1A 1AA`, `EC1A 1BB`, `M1 1AE`.
  - Not: `EC1A 1BC`, `SW1A1AA`.
  - Residual risk: short codes such as `M1 1AE` are the weakest. C, I, K, M, O and V are never unit
    letters, so `EC1A 1BC` is not a postcode.

### 3.3.8 Network and device

- **`network.ipv4`**: `(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}`,
  edges `numeric`. Validator `ipv4_scope`.
  - Hit: `52.94.236.248`, `10.0.0.5`.
  - Not: `1.3.6.1.4.1`, `256.1.1.1`, `192.0.2.1`.
  - Residual risk: a four-part version number (`2.7.2.1`). It is rare, and the gate passes the
    `private` variant by default.
- **`network.ipv6`**: `[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}`, edges `word`. Validator
  `ipv6_parse`.
  - Hit: `2a00:1450:4001:82a::200e`.
  - Not: `std::vector`, `12:30:45`, `fe80::1`, `2001:db8::8a2e:370:7334`.
  - Residual risk: `fe80::1` has only two groups, an `expected_miss` and the price of the bar.
- **`network.mac`**: `[0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5}`, edges `word`. Validators
  `separators_consistent`, `mac_not_reserved`.
  - Hit: `00:1A:2B:3C:4D:5E`.
  - Not: `ff:ff:ff:ff:ff:ff`, `00:1A-2B:3C:4D:5E`, `00:00:5e:00:53:01`.
- **`vehicle.vin`**: `[A-HJ-NPR-Z0-9]{17}`, edges `word`. Validator `vin_na`.
  - Hit: `1M8GDM9AXKP042788`.
  - Not: `1M8GDM9AYKP042788`.
  - Residual risk: 1 in 11 among 17-character upper-case identifiers that reach the validator. European
    VINs need not carry the check digit, so they may be missed; they are never falsely hit.

## 3.4 Secrets

Every secret rule has `action: redact`, and its fake value is the mask `***`. Where a pattern has
a group, group 1 is the span replaced, so `token=` stays and only the value is masked.

| Rule id | Pattern | Flags, edges, validators |
|---|---|---|
| `secret.url_credential` | `[A-Za-z][A-Za-z0-9+.-]{0,31}://([^/ \t\r\n@'"<>]{1,256})@` | edges `word_before`; validator `not_git` (the user-info `git` of an ssh remote is kept) |
| `secret.query_param` | `[?&#;](?:access[_-]?token\|refresh[_-]?token\|id[_-]?token\|oauth[_-]?token\|private[_-]?token\|auth[_-]?token\|token\|api[_-]?key\|apikey\|key\|password\|passwd\|pwd\|secret\|client[_-]?secret\|sig\|signature\|x-amz-signature\|x-amz-credential\|x-amz-security-token\|x-goog-signature\|authorization)=([^&# \t\r\n'"<>]{0,4096})` | flags `i`; edges `none` |
| `secret.auth_header` | `(?:proxy-)?authorization['"]?[ \t]{0,8}[:=][ \t]{0,8}['"]?((?:(?:Bearer\|Basic\|Token\|Digest)[ \t]{1,8})?[^ \t\r\n'"]{1,4096})` | flags `i`; edges `word_before` |
| `secret.bearer` | `Bearer[ \t]{1,8}([A-Za-z0-9._~+/-]{8,4096}={0,2})` | edges `word_before` |
| `secret.extraheader` | `x-access-token:([A-Za-z0-9+/=_-]{1,4096})` | flags `i`; edges `none` |
| `secret.keyed_value` | `["']?(?:access[_-]token\|refresh[_-]token\|id[_-]token\|oauth[_-]token\|private[_-]token\|git[_-]token\|api[_-]key\|apikey\|x-api-key\|client[_-]secret\|password\|passwd\|secret\|token)["']?[ \t]{0,8}[:=][ \t]{0,8}["']?([^ \t\r\n"',;}\]]{6,4096})` | flags `i`; edges `word_before`; validator `not_mask` (a value already `***` is left alone) |
| `secret.vendor_key` | `(?:ghp\|gho\|ghu\|ghs\|ghr)_[A-Za-z0-9]{20,255}\|github_pat_[A-Za-z0-9_]{20,255}\|glpat-[A-Za-z0-9_-]{16,255}\|sk-ant-[A-Za-z0-9_-]{16,255}\|sk-[A-Za-z0-9_-]{20,255}\|xox[abprs]-[A-Za-z0-9-]{10,255}\|AKIA[0-9A-Z]{16}` | edges `word` |

**Additional secret shapes.** These have literal prefixes or markers, so they meet the bar. They
were written from memory and **must be checked against gitleaks' default rules**
(`config/gitleaks.toml`, MIT licence) before the first release:

- `secret.private_key`: `-----BEGIN (?:[A-Z]{2,10} )?PRIVATE KEY-----[A-Za-z0-9+/=:,\r\n -]{16,16384}-----END (?:[A-Z]{2,10} )?PRIVATE KEY-----`;
- `secret.jwt`: `eyJ[A-Za-z0-9_-]{8,4096}\.eyJ[A-Za-z0-9_-]{8,4096}\.[A-Za-z0-9_-]{8,4096}`;
- `secret.vendor_key.google`: `AIza[0-9A-Za-z_-]{35}`;
- `secret.vendor_key.stripe`: `(?:sk|rk)_live_[0-9A-Za-z]{24,99}`;
- `secret.vendor_key.npm`: `npm_[A-Za-z0-9]{36}`;
- `secret.url_credential.slack_webhook`: `https://hooks\.slack\.com/services/T[A-Z0-9]{8,12}/B[A-Z0-9]{8,12}/[A-Za-z0-9]{24}`.

All have edges `word`, except `secret.private_key` and `secret.url_credential.slack_webhook`,
which have `none`.

**Behaviour to note.**
- Overlapping secret hits are merged before masking (§2.6). So `Authorization: Bearer abc…` gives
  `Authorization: ***`, and a value matched by two rules is masked once.
- The edge check replaces the lookbehinds and `\b` such scrubbers usually use. A key glued to a
  word character on its right (`ghp_…_x`) is not partly masked; it is not masked at all.
- Structured records, such as JSON whose `password` field should be emptied whatever its value,
  are the caller's job. The rule pack sees text.

**Test values.** §3.3 gives examples for every personal-data rule; secret rules need their own.
Each secret rule gets at least one synthetic hit and one look-alike that must not hit: git commit
hashes, UUIDs, hashes, base64 images, documentation placeholders such as `YOUR_API_KEY` and
`sk-xxxx`, an already-masked `***`, and `git@host:path` (§5.5).

## 3.5 Validators (the closed list)

Every implementation implements exactly these. A checksum proves only that a value is well
formed, never that it was issued.

**General checks**

| Validator | Rule | Source |
|---|---|---|
| `separators_consistent` | every separator in the match is the same character (no backreferences in the portable subset, so this is checked in code); for `contact.phone`, the two separators after the area code | — |
| `has_letter` | the match contains at least one letter | — |
| `luhn` | Luhn mod 10 over the digits | ISO/IEC 7812-1 |
| `ean13` | weights 1, 3 alternating from the left over the first 12 digits; check = (10 − sum mod 10) mod 10 | GS1 |
| `iban_mod97` | the country's IBAN length; the first four characters moved to the end, letters to numbers (A = 10); the number mod 97 equals 1 | ISO 13616, ISO/IEC 7064 MOD 97-10 |
| `card_iin` | prefix and length: Visa 4 (13, 16, 19); Mastercard 51–55 and 2221–2720 (16); American Express 34, 37 (15); Discover 6011, 644–649, 65, 622126–622925 (16–19); JCB 3528–3589 (16–19); Diners Club 300–305, 36, 38–39 (14–19) | ISO/IEC 7812 |
| `base58check` | Base58 decode to 25 bytes; the last 4 equal the first 4 of SHA-256(SHA-256(the first 21)); the version byte is one of 0x00 and 0x05 (Bitcoin; 0x05 is also Litecoin's legacy P2SH), 0x30 and 0x32 (Litecoin), 0x1E and 0x16 (Dogecoin) | Bitcoin, Litecoin and Dogecoin `chainparams.cpp` |
| `bech32` | human-readable part `bc` or `ltc`; the BIP 173 checksum (constant 1) for witness version 0, the BIP 350 checksum (0x2bc830a3) for versions 1–16 | BIP 173, BIP 350 |
| `mrz_td3`, `mrz_td2`, `mrz_td1` | each field's check digit: weights 7, 3, 1 repeated, `<` = 0, A = 10 … Z = 35, sum mod 10. Document number, birth date and expiry date in every layout; personal number and composite in TD3 and TD2. The TD1 composite is not applied yet (§3.3.5) | ICAO Doc 9303, as reproduced on Wikipedia and in the `mrz` library (the ICAO site refused automated reading) |
| `vin_na` | transliterate (A–H → 1–8, J–N → 1–5, P → 7, R → 9, S–Z → 2–9); weights 8 7 6 5 4 3 2 10 0 9 8 7 6 5 4 3 2; sum mod 11 (10 is `X`) equals position 9; position 10 not U, Z or 0; at least one letter and one digit | 49 CFR 565 |

**North America**

| Validator | Rule | Source |
|---|---|---|
| `ssn_rules` | area not 000, 666 or 900–999; group not 00; serial not 0000; not `078-05-1120`, `219-09-9999` or `123-45-6789` | SSA, Presidio |
| `itin_rules` | first digit 9; digits 4–5 in 50–65, 70–88, 90–92 or 94–99 (93: `variant: atin`) | IRS |
| `ca_bn` | Luhn over the nine digits of the business number | python-stdnum `ca.bn` |
| `nanp_rules` | area code and exchange code `[2-9]XX`, neither of the form N11; not 555-0100 to 555-0199 | NANPA |

**Europe**

| Validator | Rule | Source |
|---|---|---|
| `be_nn` | raw month 00–12; date real when month and day are not 0; check = 97 − (first 9 digits mod 97), or the same with a `2` prefixed (born from 2000) | python-stdnum `be.nn` |
| `cz_rc` | month = MM mod 50 mod 20 (women +50, overflow +20); year 1954–2053 from YY; date real; first 9 digits mod 11 mod 10 = last digit | python-stdnum `cz.rc` |
| `es_dni`, `es_nie` | letter = `TRWAGMYFPDXBNJZSQVHLCKE`[number mod 23], with X, Y, Z read as 0, 1, 2 for the NIE | python-stdnum `es.dni`, `es.nie` |
| `fi_hetu` | DDMMYY a real date with the century from the sign (`+` 1800; `-`, Y, X, W, V, U 1900; A–F 2000); individual number at least 002 (900–999 `variant: temporary`); check = `0123456789ABCDEFHJKLMNPRSTUVWXY`[DDMMYYNNN mod 31] | python-stdnum `fi.hetu` |
| `fr_nir` | `2A` read as 19, `2B` as 18; key = 97 − (first 13 digits mod 97) | python-stdnum `fr.nir` |
| `nino_prefix` | the two letters are not BG, GB, KN, NK, NT, TN, ZZ, FY or NC | HMRC NIM39110 |
| `gb_dl_surname` | the first five characters are letters followed only by 9s, and not `99999` | Presidio |
| `ie_pps` | check letter = `WABCDEFGHIJKLMNOPQRSTUV`[(Σ (8 − i) × dᵢ over the 7 digits, plus 9 × the second letter's index when it is A, B or H) mod 23] | python-stdnum `ie.pps` |
| `it_cf` | the date decodes (omocodia letters L–V for digits, month letter `ABCDEHLMPRST`, day + 40 for women); check letter from the odd and even tables over the first 15 characters, mod 26 | python-stdnum `it.codicefiscale` |
| `no_fnr` | two mod-11 check digits (weights 3, 7, 6, 1, 8, 9, 4, 5, 2 and 5, 4, 3, 2, 7, 6, 5, 4, 3, 2); a real date, with D-numbers (day + 40) and H-numbers (month + 40); day 80 or more rejected | python-stdnum `no.fodselsnummer` |
| `se_pnr` | a real date (day + 60 for coordination numbers accepted), any century; Luhn over the last ten digits | python-stdnum `se.personnummer` |
| `eu_vat` | AT: (6 − Luhn checksum of the 7 digits after `U`) mod 10 = the 8th. BE: first 8 digits + last 2 ≡ 0 mod 97, first digit 0 or 1. DE: ISO 7064 MOD 11,10. ES: the DNI, NIE or CIF rules of python-stdnum `es.nif`. FR: numeric key = (SIREN followed by `12`) mod 97, and the SIREN passes Luhn; letter keys by `fr.tva`. IT: Luhn over 11 digits. NL: the BSN eleven-test on the 9 digits, or ISO 7064 MOD 97-10 over `NL` and the number (the format since 2020). PL: weights 6, 5, 7, 2, 3, 4, 5, 6, 7 and −1, sum ≡ 0 mod 11. SE: Luhn over the first ten digits | python-stdnum `at.uid`, `be.vat`, `de.vat`, `es.nif`, `fr.tva`, `it.iva`, `nl.btw`, `pl.nip`, `se.vat` |

**Asia-Pacific**

| Validator | Rule | Source |
|---|---|---|
| `cn_ric` | YYYYMMDD a real date; check = (1 − 2 × (first 17 digits read in base 13)) mod 11, 10 written `X` (ISO 7064 MOD 11-2) | python-stdnum `cn.ric` |
| `cn_uscc` | alphabet `0123456789ABCDEFGHJKLMNPQRTUWXY`; weights 1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28; check = alphabet[(31 − sum mod 31) mod 31] | python-stdnum `cn.uscc` |
| `hkid` | values A = 10 … Z = 35, a single letter preceded by a space worth 36; weights 9 … 2; check = (11 − sum mod 11) mod 11, 10 written `A` | stdnum-js `hk.hkid` |
| `in_pan` | serial (characters 6–9) not `0000` | python-stdnum `in_.pan` |
| `in_gstin` | state code 01–37; characters 3–12 a PAN; Luhn mod 36 over all 15 characters | python-stdnum `in_.gstin` |
| `kr_rrn` | the date real, century from the seventh digit (1, 2, 5, 6: 1900s; 3, 4, 7, 8: 2000s); no checksum | python-stdnum `kr.rrn`, the 2020 change as reported |
| `sg_nric` | digits weighted 2, 7, 6, 5, 4, 3, 2, plus 4 for T and G, 3 for M; letter from `JZIHGFEDCBA` (S, T), `XWUTRQPNMLK` (F, G) or `XWUTRQPNJLK` (M) at sum mod 11 | open-source validators (unpublished officially) |

**Latin America and Africa**

| Validator | Rule | Source |
|---|---|---|
| `br_cpf` | two check digits, weights 10 … 2 then 11 … 2, each (11 − sum mod 11) mod 11 mod 10; not all one digit | python-stdnum `br.cpf` |
| `br_cnpj` | character value = code − 48 (so A = 17); weights 5, 4, 3, 2, 9 … 2 then 6, 5, 4, 3, 2, 9 … 2; each check (11 − sum mod 11) mod 11 mod 10 | python-stdnum `br.cnpj` |
| `mx_curp` | birth date real (century from character 17); character 11 `H` or `M`; state code from the list of 33; check = (10 − Σ index × (18 − i) mod 10) mod 10 over alphabet `0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ` | python-stdnum `mx.curp` |
| `za_id` | YYMMDD a real date in either century; digit 11 is 0 or 1; Luhn over 13 digits | python-stdnum `za.idnr` |

**Contact and network**

| Validator | Rule | Source |
|---|---|---|
| `email_shape` | no leading, trailing or doubled dot in the local part; no domain label starting or ending with a hyphen; an alphabetic top-level label of 2 to 63 letters; not an image file name (`@2x.png`); not an ssh remote (local part `git` followed by `:`); not a reserved domain (§2.4) | RFC 5321, RFC 5322, RFC 2606, RFC 6761 |
| `ipv4_scope` | rejects 0/8 and the documentation ranges 192.0.2/24, 198.51.100/24, 203.0.113/24; sets the variant from the other special-purpose ranges (10/8, 172.16/12, 192.168/16: `private`; 127/8: `loopback`; 169.254/16: `link_local`) | RFC 6890, RFC 5737 |
| `ipv6_parse` | a valid text form (eight groups, or fewer with one `::`), at least three non-empty groups; not in 2001:db8::/32 | RFC 4291, RFC 3849 |
| `mac_not_reserved` | not `00:00:00:00:00:00`, not `ff:ff:ff:ff:ff:ff`, not `00:00:5e:00:53:00` to `00:00:5e:00:53:ff` | IEEE EUI-48, RFC 7042 |

A checksum proves only that a value is well formed, never that it was issued.

## 3.6 Not detected, and why

Each of these fails the bar on its own value. Where it was measured, the random pass rate is over
400,000 random values of the shape. "Would need" is what a later version, a library-backed mode or
a model would add. A caller who needs any of them can add the values to a term list.

| Detector | Random pass rate | Would need | What was found |
|---|---|---|---|
| SSN and ITIN without hyphens; SSN with spaces or dots | — | a context word | the validators of §3.5 apply unchanged |
| Canadian SIN | 1 in 10 | a context word (`sin`, `social insurance`, `nas`) | nine digits, often 3-3-3; Luhn; first digit not 0 or 8 (9: temporary resident); `046 454 286` is the usual sample |
| US EIN | — | a context word (`ein`, `employer identification`) | `dd-ddddddd`; every two-digit prefix except 00, 07–09, 17–19, 28, 29, 49, 69, 70, 78, 79, 89, 96, 97 (IRS, read 2026-11-11) |
| Canadian business number without its program account | 1 in 10 | a context word (`business number`, `gst`) | nine digits, Luhn |
| MBI without hyphens | — | a context word (`medicare`) | the same position types |
| NPI | 1 in 10 | a context word (`npi`) | ten digits starting 1 or 2; Luhn over `80840` and the ten digits |
| DEA number | 1 in 10 | a context word (`dea`) | two letters and seven digits; (d1 + d3 + d5) + 2 × (d2 + d4 + d6) ends in d7 |
| Ontario health number | 1 in 10 | a context word (`ohip`) | ten digits and a version code; Luhn per a secondary source |
| British Columbia PHN | 1 in 11 | a context word (`phn`) | first digit 9; weights 2, 4, 8, 5, 10, 9, 7, 3, each product mod 11; check = (11 − sum) mod 11 |
| Quebec NAM | — | a context word (`ramq`) | four letters and eight digits encoding birth date and sex; no published check |
| Alberta PHN, Canadian UCI | — | a context word | no published check |
| US routing, Canadian transit, bank accounts | 1 in 10 (routing) | a context word | routing weights 3, 7, 1; prefixes 00–12, 21–32, 61–72, 80 |
| Passports (outside the MRZ) | — | a context word (`passport`) | US: a letter and eight digits since 2021, nine digits before; Canada: two letters, six digits |
| Driver's licences (outside the UK) | — | a label | formats differ by state and province |
| Belgian national number without its dots | 1 in 990 | the printed form, or a context word | — |
| Swiss AHV without its dots | 1 in 10 after the `756` | the printed form | 756 is also a possible product barcode prefix |
| French NIR unformatted | 1 in 503 | the printed grouping | — |
| Norwegian birth number unformatted | 1 in 867 | the printed spacing | 11-digit runs are common (phone numbers) |
| Romanian CNP | 1 in 547 | a context word (`cnp`) | 13 digits: sex and century, YYMMDD, county 01–48, 51, 52, 70, 80–83, serial, check with weights 2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9 mod 11 (10 → 1); EAN-13 barcodes share the length |
| Polish PESEL | 1 in 54 | a context word (`pesel`) | century in the month (+20, +40, +60, +80); weights 1, 3, 7, 9 |
| German tax ID (IdNr) | 1 in 295 | a context word (`steuer-id`, `idnr`) | one digit repeated twice or thrice in the first ten; ISO 7064 MOD 11,10 |
| Dutch BSN | 1 in 11 | a context word (`bsn`) | eleven-test |
| Danish CPR | no check since 2007 | a context word (`cpr`) | `DDMMYY-NNNN` |
| UK NHS number | 1 in 11 | a context word (`nhs`) | `### ### ####`, the layout of North American phone numbers; mod 11 |
| Turkish T.C. Kimlik | 1 in 110 | a context word | two check digits |
| Australian ABN | 1 in 89 | a context word (`abn`) | `## ### ### ###`; mod 89 |
| Brazilian CPF unformatted | 1 in 102 | the printed form | — |
| Indian Aadhaar | 1 in 12 | a context word (`aadhaar`, `uid`) | `#### #### ####`; first digit 2–9; Verhoeff |
| Japanese My Number, corporate number | 1 in 10, 1 in 9 | a context word (`マイナンバー`, `個人番号`) | weights 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2, (−sum) mod 11 mod 10 |
| Japanese residence card | no check | a context word (`在留カード`) | two letters, eight digits, two letters |
| Taiwan national ID | 1 in 10 | a context word | a letter, 1, 2, 8 or 9, eight digits; letter values 10–35 split into two digits; weights 1, 9, 8 … 1, 1; sum mod 10 |
| Korean RRN without the hyphen | — | the hyphen | — |
| Mexican RFC | no reliable check (about 1.5% of numbers in use fail it) | a context word (`rfc`) | four letters, YYMMDD, three characters |
| Ethereum addresses | — | Keccak-256 in every engine, for EIP-55; all-lower and all-upper addresses carry no checksum at all | `0x` and forty hex digits |
| Phone numbers outside North America; NANP without separators | — | libphonenumber's metadata | — |
| Postal codes elsewhere; ZIP codes; Canadian codes without the space | — | a context word or the address around them | — |
| Street addresses, dates of birth, names, member and account numbers, passwords in prose | — | a label, or a model | labelled patterns were drafted and dropped on 2026-11-11 for their false positives (`the password is incorrect`, `Dear Team`) |
| Ages, a year of birth alone | — | a model | quasi-identifiers; rules do not claim them |

## 3.7 Defend rules

Defend rules annotate; they never remove personal data. Their default action is `flag`. A profile
raises the categories it chooses to `neutralise` or `block` (§2.7).

| Rule id | Pattern | Flags, edges | Finds |
|---|---|---|---|
| `inject.special_token` | `<\|(?:im_start\|im_end\|im_sep\|system\|user\|assistant\|endoftext\|eot_id\|start_header_id\|end_header_id\|begin_of_text\|python_tag)\|>\|\[/?INST\]\|<</?SYS>>\|<(?:start\|end)_of_turn>` | edges `none` | chat-template control tokens of the common open models |
| `inject.role_label` | `^(?:Human\|Assistant\|System\|User\|AI):[ \t]` | flags `m`; edges `none` | a turn label at the start of a line |
| `inject.override_phrase` | `(?:ignore\|disregard\|forget)[ ](?:all[ ]\|any[ ])?(?:the[ ]\|your[ ])?(?:previous\|prior\|above\|earlier\|preceding)[ ](?:instructions\|directions\|prompts?\|rules)` | flags `i`; edges `word` | the classic override phrasing |
| `inject.tool_markup` | `</?(?:tool_call\|tool_use\|function_calls?\|invoke)[ >/]` | edges `none` | tool-call markup in plain content |
| `inject.md_image_remote` | `!\[[^\]\n]{0,256}\]\((?:https?:)?//[^) \t\r\n]{1,2048}\)` | edges `none` | a Markdown image that a renderer would fetch: an exfiltration channel |
| `hidden.encoded_blob` | `[A-Za-z0-9+/]{256,65536}={0,2}` | edges `word` | a long Base64 run (flag only: images embedded in documents are common) |
| `hidden.invisible` | — (the normaliser, §2.3) | — | invisible characters removed |
| `inject.consumer_markup` | `neutralise_literals` (§2.2) | — | a consumer's own markup; always `neutralise` |

The role-label, override and tool-markup rules also match ordinary text in documents *about*
prompts and chats. That is why they default to `flag`, and why the `document` profile keeps them
at `flag`.
