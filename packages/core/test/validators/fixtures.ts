// Test fixtures for the validator tests: the hit and not-hit examples of §3.3 and §3.4 grouped
// by rule, with the validators that rule names (§3.5) and what each example must do. A not-hit
// listed here is one the validators themselves must reject; shapes rejected by the pattern alone
// (`536 22 8914`, `100-0001`, `SW1A1AA`) belong to the conformance cases, not to this table.
import { VALIDATORS } from "../../src/validators";

export interface RuleExamples {
  rule: string;
  /** Validators in the order the rule lists them (§3.3). */
  validators: string[];
  hit: string[];
  not: string[];
  /** True when the last character of every hit is a check digit (changing it must reject). */
  checkLast?: boolean;
}

const TD3_HIT =
  "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10";
const TD2_HIT = "I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<\nD231458907UTO7408122F1204159<<<<<<<6";
const TD1_HIT =
  "I<UTOD231458907<<<<<<<<<<<<<<<\n7408122F1204159UTO<<<<<<<<<<<6\nERIKSSON<<ANNA<MARIA<<<<<<<<<<";

export const RULES: RuleExamples[] = [
  {
    rule: "gov_id.us_ssn",
    validators: ["ssn_rules"],
    hit: ["536-22-8914"],
    not: [
      "078-05-1120",
      "666-12-3456",
      "536-00-8914",
      "912-73-4567",
      "536-22-0000",
      "000-22-8914",
      "219-09-9999",
      "123-45-6789",
    ],
  },
  {
    rule: "gov_id.us_itin",
    validators: ["itin_rules"],
    hit: ["912-73-4567", "912-93-4567"],
    not: ["912-34-5678", "812-73-4567", "912-66-4567"],
  },
  {
    rule: "org_id.ca_bn",
    validators: ["ca_bn"],
    hit: ["123026635 RC 0001", "123026635RC0001"],
    not: ["123456789 RT 0001"],
    checkLast: false,
  },
  {
    rule: "gov_id.be_nn",
    validators: ["be_nn"],
    hit: ["85.07.30-033.28"],
    not: ["85.07.30-033.29", "85.13.30-033.28"],
    checkLast: true,
  },
  {
    rule: "gov_id.ch_ahv",
    validators: ["ean13"],
    hit: ["756.9217.0769.85"],
    not: ["756.9217.0769.84"],
    checkLast: true,
  },
  {
    rule: "gov_id.cz_rc",
    validators: ["cz_rc"],
    hit: ["710319/2745"],
    not: ["710319/2746", "711319/2745"],
    checkLast: true,
  },
  {
    rule: "gov_id.es_dni",
    validators: ["es_dni"],
    hit: ["54362315K", "54362315-K"],
    not: ["54362315Z"],
  },
  { rule: "gov_id.es_nie", validators: ["es_nie"], hit: ["X2482300W"], not: ["X2482300A"] },
  {
    rule: "gov_id.fi_hetu",
    validators: ["fi_hetu"],
    hit: ["131052-308T"],
    not: ["131052-308U", "310252-308Y", "131052-001V"],
  },
  {
    rule: "gov_id.fr_nir",
    validators: ["fr_nir"],
    hit: ["2 95 10 99 126 111 93"],
    not: ["2 95 10 99 126 111 99"],
  },
  {
    rule: "gov_id.gb_nino",
    validators: ["nino_prefix"],
    hit: ["HH 01 23 45 D"],
    not: ["QQ 12 34 56 C", "GB 12 34 56 A", "NK 12 34 56 A", "ZZ 12 34 56 A"],
  },
  {
    rule: "gov_id.gb_driving_licence",
    validators: ["gb_dl_surname"],
    hit: ["MORGA753116SM9IJ"],
    not: ["99999753116SM9IJ", "MO9GA753116SM9IJ"],
  },
  {
    rule: "gov_id.ie_pps",
    validators: ["ie_pps"],
    hit: ["6433435F", "6433435FW"],
    not: ["6433435E"],
  },
  {
    rule: "gov_id.it_cf",
    validators: ["it_cf"],
    hit: ["RCCMNL83S18D969H"],
    not: ["RCCMNL83S18D969A", "RCCMNL83S32D969H"],
    checkLast: false,
  },
  {
    rule: "gov_id.no_fnr",
    validators: ["no_fnr"],
    hit: ["151086 95088"],
    not: ["151086 95077"],
    checkLast: true,
  },
  {
    rule: "gov_id.se_pnr",
    validators: ["se_pnr"],
    hit: ["880320-0016", "19880320-0016"],
    not: ["880320-0018"],
    checkLast: true,
  },
  {
    rule: "org_id.eu_vat",
    validators: ["eu_vat"],
    hit: [
      "ATU13585627",
      "BE0428759497",
      "DE136695976",
      "ESB64717838",
      "FR23334175221",
      "IT00743110157",
      "NL004495445B01",
      "PL8567346215",
      "SE123456789701",
    ],
    not: [
      "DE136695978",
      "ATU13585626",
      "XX123456789",
      "BE0428759498",
      "IT00743110158",
      "PL8567346216",
    ],
  },
  {
    rule: "gov_id.cn_ric",
    validators: ["cn_ric"],
    hit: ["360426199101010071"],
    not: ["360426199101010072", "360426199102300071"],
  },
  {
    rule: "gov_id.hk_hkid",
    validators: ["hkid"],
    hit: ["G123456(A)", "AB987654(3)"],
    not: ["C567890(8)"],
  },
  {
    rule: "gov_id.in_pan",
    validators: ["in_pan"],
    hit: ["ACUPA7085R"],
    not: ["ABMXA3211G", "ACUPA0000R"],
  },
  {
    rule: "org_id.in_gstin",
    validators: ["in_gstin"],
    hit: ["27AAPFU0939F1ZV"],
    not: ["27AAPFU0939F1ZO", "38AAPFU0939F1ZV"],
  },
  {
    rule: "gov_id.kr_rrn",
    validators: ["kr_rrn"],
    hit: ["971013-1019902"],
    not: ["971331-1019902", "971013-9019902", "970230-1019902"],
  },
  {
    rule: "gov_id.sg_nric",
    validators: ["sg_nric"],
    hit: ["S0000001I", "M5043078W"],
    not: ["T5717279A"],
  },
  {
    rule: "org_id.cn_uscc",
    validators: ["cn_uscc", "has_letter"],
    hit: ["91110000600037341L"],
    not: ["91110000600037341M"],
  },
  {
    rule: "gov_id.br_cpf",
    validators: ["br_cpf"],
    hit: ["390.533.447-05"],
    not: ["231.002.999-00", "111.111.111-11"],
  },
  {
    rule: "org_id.br_cnpj",
    validators: ["br_cnpj"],
    hit: ["16.727.230/0001-97", "12.ABC.345/01DE-35"],
    not: ["16.727.230/0001-98"],
  },
  {
    rule: "gov_id.mx_curp",
    validators: ["mx_curp"],
    hit: ["BOXW310820HNERXN09"],
    not: ["BOXW310820HNERXN08"],
    checkLast: true,
  },
  { rule: "gov_id.za_id", validators: ["za_id"], hit: ["7503305044089"], not: ["8503305044089"] },
  {
    rule: "gov_id.mrz.td3",
    validators: ["mrz_td3"],
    hit: [TD3_HIT],
    not: [TD3_HIT.slice(0, -1) + "1"],
  },
  {
    rule: "gov_id.mrz.td2",
    validators: ["mrz_td2"],
    hit: [TD2_HIT],
    not: [TD2_HIT.slice(0, -1) + "7"],
  },
  {
    rule: "gov_id.mrz.td1",
    validators: ["mrz_td1"],
    hit: [TD1_HIT],
    not: [
      TD1_HIT.replace("D231458907", "D231458908"),
      // Only the composite digit is wrong.
      TD1_HIT.replace("UTO<<<<<<<<<<<6", "UTO<<<<<<<<<<<7"),
    ],
  },
  {
    rule: "financial.payment_card",
    validators: ["separators_consistent", "luhn", "card_iin"],
    hit: ["4111 1111 1111 1111", "3782 822463 10005", "5555555555554444"],
    not: ["4111 1111 1111 1112", "1234 5678 9012 3456", "4111-1111 1111-1111"],
  },
  {
    rule: "financial.iban",
    validators: ["iban_mod97"],
    hit: ["GB82 WEST 1234 5698 7654 32"],
    not: ["GB82 WEST 1234 5698 7654 33"],
    checkLast: false,
  },
  {
    rule: "financial.crypto_address.base58",
    validators: ["base58check"],
    hit: [
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      "LT2KVaAy1ppRuxRgrS5RNU3vBsy7RibPeA",
      "DD4KSSuBJqcjuTcvUg1CgUKeurPUFeEZkE",
    ],
    not: ["1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3"],
  },
  {
    rule: "financial.crypto_address.bech32",
    validators: ["bech32"],
    hit: [
      "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
      "ltc1qhdhvrwe6rgqns8fz28tee0hphr5x7ulw5exv4w",
    ],
    not: ["bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdr"],
  },
  {
    rule: "contact.email",
    validators: ["email_shape"],
    hit: ["jane.doe@northwind-mail.com"],
    not: [
      "icon@2x.png",
      "person1@example.com",
      "a..b@northwind-mail.com",
      ".a@northwind-mail.com",
      "a@-bad.com",
      "a@bad-.com",
      "a@sub.example.org",
      "a@host.test",
      "a@host.invalid",
      "git@github.com",
    ],
  },
  {
    rule: "contact.phone",
    validators: ["nanp_rules", "separators_consistent"],
    hit: ["(202) 456-1111", "+1 613 992 4211", "202-456-1111"],
    not: ["(212) 555-0147", "202-456.1111", "(211) 456-1111", "(202) 411-1111", "(102) 456-1111"],
  },
  {
    rule: "network.ipv4",
    validators: ["ipv4_scope"],
    hit: ["52.94.236.248", "10.0.0.5", "127.0.0.1", "169.254.1.1"],
    not: [
      "192.0.2.1",
      "192.0.2.0",
      "192.0.2.255",
      "198.51.100.7",
      "203.0.113.200",
      "0.1.2.3",
      "256.1.1.1",
    ],
  },
  {
    rule: "network.ipv6",
    validators: ["ipv6_parse"],
    hit: ["2a00:1450:4001:82a::200e", "2a00:1450:4001:82a:1:2:3:4"],
    not: [
      "fe80::1",
      "2001:db8::8a2e:370:7334",
      "12:30:45",
      "std::vector",
      "1:2:3:4:5:6:7:8:9",
      "1::2::3",
    ],
  },
  {
    rule: "network.mac",
    validators: ["separators_consistent", "mac_not_reserved"],
    hit: ["00:1A:2B:3C:4D:5E", "00-1A-2B-3C-4D-5E"],
    not: ["ff:ff:ff:ff:ff:ff", "00:1A-2B:3C:4D:5E", "00:00:5e:00:53:01", "00:00:00:00:00:00"],
  },
  {
    rule: "vehicle.vin",
    validators: ["vin_na"],
    hit: ["1M8GDM9AXKP042788"],
    not: ["1M8GDM9AYKP042788"],
  },
  {
    rule: "secret.url_credential",
    validators: ["not_git", "not_mask"],
    hit: ["https://user:pw@", "ftp://bob@"],
    not: ["ssh://git@", "https://***@"],
  },
  {
    rule: "secret.keyed_value",
    validators: ["not_mask"],
    hit: ["password=hunter22", "token: abcdef", "api_key=ab***cd"],
    not: ["password=***", "token: '***", "token: '***'", "password=*****"],
  },
];

export function runValidators(names: string[], text: string): boolean {
  for (const n of names) {
    const v = VALIDATORS[n];
    if (v === undefined) throw new Error(`unknown validator ${n}`);
    if (!v(text).ok) return false;
  }
  return true;
}

/** The answer of every validator, for each example, used to compare runs (VAL-3). */
export function allAnswers(): string[] {
  const out: string[] = [];
  for (const r of RULES) {
    for (const t of [...r.hit, ...r.not]) {
      for (const n of r.validators) {
        out.push(
          `${r.rule}|${n}|${JSON.stringify(t)}|${JSON.stringify((VALIDATORS[n] as (s: string) => unknown)(t))}`,
        );
      }
    }
  }
  return out;
}
